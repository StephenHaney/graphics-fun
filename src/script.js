const agentSize = 1;
const halfSize = Math.max(1, agentSize / 2);

const vs = `
attribute vec4 position;

void main() {
  gl_Position = position;
  gl_PointSize = ${agentSize}.0;
}
`;

const fs = `
precision mediump float;

void main() {
  gl_FragColor = vec4(0.0, 0.2, 0.8, 1);
}
`;

(() => {
  const canvas = document.getElementById('rendering-canvas');
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  const programInfo = twgl.createProgramInfo(gl, [vs, fs]);

  /** State */
  const state = {
    playing: true,
  };

  // Keep the canvas full screen at all times
  function makeCanvasFullScreen() {
    const controlsWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--controls-width')
    );
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth - controlsWidth;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  }
  // Resize listener:
  window.addEventListener('resize', makeCanvasFullScreen);
  // Initial set:
  makeCanvasFullScreen();

  /** Agents */
  const agents = [];
  function initAgents() {
    // Generate agents
    for (let i = 0; i < 2000; i++) {
      agents.push({
        x: getRandomNumber(0, canvas.clientWidth),
        y: getRandomNumber(0, canvas.clientHeight),
        rotation: getRandomNumber(0, Math.PI * 2),
        color: `rgba(100, 100, 170, 0.3)`,
        headStrong: 0,
      });
    }
  }

  let bufferInfo = null;
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  function draw(time) {
    requestAnimationFrame(draw);
    if (!state.playing) {
      return;
    }

    const vertices = [];

    for (const agent of agents) {
      let dx = Math.cos(agent.rotation);
      let dy = Math.sin(agent.rotation);

      if (agent.headStrong > 0) {
        // If it's currently headstrong it's blazing its own path, just decrease its headstrong count
        agent.headStrong -= 1;
        // } else if (getRandomNumber(1, 1000) === 1000) {
        //   // 1 time out of 1000 pick a random new direction to go and go HEADSTRONG
        //   let newDirection = Math.random(0, 2 * Math.PI, false);
        //   dx = Math.cos(newDirection);
        //   dy = Math.sin(newDirection);
        //   agent.headStrong = 50;
      } else {
        // Sample ahead for steering
        const centerSample = getPixelFromPoint(
          pixels,
          agent.x + dx * 50,
          agent.y + dy * 50,
          canvas.clientHeight,
          canvas.clientHeight
        );
        if (centerSample.a === 0) {
          // Center is negative, check the sides
          const leftDx = Math.cos(agent.rotation + 1);
          const leftDy = Math.sin(agent.rotation + 1);
          const leftSample = getPixelFromPoint(
            pixels,
            agent.x + leftDx * 50,
            agent.y + leftDy * 50,
            canvas.clientHeight,
            canvas.clientHeight
          );
          const rightDx = Math.cos(agent.rotation - 1);
          const rightDy = Math.sin(agent.rotation - 1);
          const rightSample = getPixelFromPoint(
            pixels,
            agent.x + rightDx * 50,
            agent.y + rightDy * 50,
            canvas.clientHeight,
            canvas.clientHeight
          );

          if (leftSample.a !== 0) {
            // console.log('turn left!');
            // console.log(
            //   `x: ${agent.x} y: ${agent.y} checking spot: ${agent.x + leftDx * 50} x ${
            //     agent.y + leftDy * 50
            //   }`
            // );
            // Turn left!
            agent.rotation += 0.7;
            dx = leftDx;
            dy = leftDy;
          } else if (rightSample.a !== 0) {
            // console.log('turn right!');
            // Turn right!
            agent.rotation -= 0.7;
            dx = rightDx;
            dy = rightDy;
          }
        }
      }

      // Move forward
      agent.x += dx;
      agent.y += dy;

      // Flip X if it hits bounds
      if (agent.x - halfSize <= 0) {
        agent.x = halfSize;
        // Flip the dx and calculate it in radians
        agent.rotation = Math.atan2(dy, -dx);
      } else if (agent.x + halfSize >= canvas.clientWidth) {
        agent.x = canvas.clientWidth - halfSize;
        // Flip the dx and calculate it in radians
        agent.rotation = Math.atan2(dy, -dx);
      }

      // Flip Y if it hits bounds
      if (agent.y - halfSize <= 0) {
        agent.y = halfSize;
        // Flip the dy and calculate it in radians
        agent.rotation = Math.atan2(-dy, dx);
      } else if (agent.y + halfSize >= canvas.clientHeight) {
        agent.y = canvas.clientHeight - halfSize;
        // Flip the dy and calculate it in radians
        agent.rotation = Math.atan2(-dy, dx);
      }

      // Push WebGL clipspace vertices
      const xToClip = (agent.x / canvas.clientWidth) * 2 - 1;
      const yToClip = (agent.y / canvas.clientHeight) * 2 - 1;
      vertices.push(xToClip, yToClip, 1);
    }

    // Put the positions onto the GPU
    if (bufferInfo === null) {
      bufferInfo = twgl.createBufferInfoFromArrays(gl, { position: vertices });
    } else {
      twgl.setAttribInfoBufferFromArray(gl, bufferInfo.attribs.position, vertices);
    }

    // Draw the new positions
    gl.useProgram(programInfo.program);
    twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
    // twgl.setUniforms(programInfo, uniforms);
    twgl.drawBufferInfo(gl, bufferInfo, gl.POINTS);

    // Store the new pixels for the next round
    gl.readPixels(
      0,
      0,
      canvas.clientWidth,
      canvas.clientHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
  }

  initAgents();
  requestAnimationFrame(draw);

  /** Controls */
  const playPauseBtn = document.getElementById('btn-play-pause');
  playPauseBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    playPauseBtn.innerText = state.playing ? 'Pause' : 'Play';
  });
})();

function getRandomNumber(min, max, round = true) {
  min = Math.ceil(min);
  max = Math.floor(max);

  const result = Math.random() * (max - min + 1) + min;
  return round ? Math.floor(result) : result;
}

function getPixelFromPoint(pixels, x, y, width, height) {
  const index = (Math.floor(y) * width + Math.floor(x)) * 4;
  return {
    r: pixels[index],
    g: pixels[index + 1],
    b: pixels[index + 2],
    a: pixels[index + 3],
  };
}
