const agentSize = 2;
const halfSize = Math.max(1, agentSize / 2);

const vs = `
attribute vec4 position;
// attribute vec4 a_Color;
// varying vec4 v_Color;

void main() {
  gl_Position = position;
  gl_PointSize = ${agentSize}.0;
  // v_Color = a_Color;
}
`;

const fs = `
precision mediump float;
// varying vec4 v_Color;

void main() {
  gl_FragColor = vec4(0.2, 0.6, 0.8, 1.0);
}
`;

(() => {
  const canvas = document.getElementById('rendering-canvas');
  // const gl = canvas.getContext('webgl');
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
    for (let i = 0; i < 1000; i++) {
      agents.push({
        x: getRandomNumber(0, canvas.clientWidth),
        y: getRandomNumber(0, canvas.clientHeight),
        rotation: getRandomNumber(0, Math.PI * 2, false),
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
        const centerSample = getPixelFromPoint(agent.x + dx * 50, agent.y + dy * 50);
        // vertices.push(...pixelsToClip(agent.x + dx * 23, agent.y + dy * 23));
        if (centerSample.a === 0) {
          // Center is negative, check the sides
          const leftDx = Math.cos(agent.rotation + 1);
          const leftDy = Math.sin(agent.rotation + 1);
          const leftSample = getPixelFromPoint(
            agent.x + leftDx * 50,
            agent.y + leftDy * 50
          );
          // vertices.push(...pixelsToClip(agent.x + leftDx * 23, agent.y + leftDy * 23));
          const rightDx = Math.cos(agent.rotation - 1);
          const rightDy = Math.sin(agent.rotation - 1);
          const rightSample = getPixelFromPoint(
            agent.x + rightDx * 50,
            agent.y + rightDy * 50
          );
          // vertices.push(...pixelsToClip(agent.x + rightDx * 23, agent.y + rightDy * 23));

          if (leftSample.a !== 0) {
            // console.log('turn left!');
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
      bufferInfo = twgl.createBufferInfoFromArrays(gl, {
        position: vertices,
      });
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
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
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

  function pixelsToClip(x, y) {
    return [
      (x / gl.drawingBufferWidth) * 2 - 1,
      (y / gl.drawingBufferHeight) * 2 - 1,
      1, // depth
    ];
  }

  function getPixelFromPoint(x, y) {
    const index = (Math.floor(y) * gl.drawingBufferWidth + Math.floor(x)) * 4;
    return {
      r: pixels[index] || 0,
      g: pixels[index + 1] || 0,
      b: pixels[index + 2] || 0,
      a: pixels[index + 3] || 0,
    };
  }
})();

function getRandomNumber(min, max, round = true) {
  const result = Math.random() * (max - min + 1) + min;
  return round ? Math.floor(result) : result;
}
