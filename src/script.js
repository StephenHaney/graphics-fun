const agentSize = 1;
const halfSize = Math.max(1, agentSize / 2);

const vsAgents = `
attribute vec4 position;

void main() {
  gl_Position = position;
  gl_PointSize = ${agentSize}.0;
}
`;

const fsAgents = `
precision mediump float;

void main() {
  gl_FragColor = vec4(0.2, 0.6, 0.8, 1.0);
}
`;

/** Spits out positions and matching texture coordinates for a provided rectangle area */
const vsQuad = `
attribute vec4 position;
attribute vec2 texcoord;

varying vec2 v_texcoord;

void main() {
  gl_Position = position;
  v_texcoord = texcoord;
}
`;

/** Mixes down between a pixel's color from the texture and a uniform color */
const fsFade = `
precision mediump float;

varying vec2 v_texcoord;

uniform sampler2D u_texture;
uniform float u_mixAmount;
uniform vec4 u_fadeColor;
uniform vec2 u_textureSize;

void main() {
  vec2 onePixel = vec2(1.0, 1.0) / u_textureSize;

  vec4 blur_color = (
    texture2D(u_texture, v_texcoord + onePixel * vec2(-1.0, -1.0)) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(0.0, -1.0)) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(1.0, -1.0)) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(-1.0, 0.0)) +
    texture2D(u_texture, v_texcoord) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(1.0,  0.0)) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(-1.0, 1.0)) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(0.0,  1.0)) +
    texture2D(u_texture, v_texcoord + onePixel * vec2(1.0,  1.0))) / 9.0;

  // Fade to transparency
  vec4 mixed_color = mix(blur_color, u_fadeColor, u_mixAmount);

  if (mixed_color.a < 0.1) {
    // It never seems to actually get to 0, so this helps it get there:
    mixed_color = vec4(0, 0, 0, 0);
  }

  // Blur time
  gl_FragColor = mixed_color;
}
`;

/** Prints a texture out exactly */
const fsCopy = `
precision mediump float;

varying vec2 v_texcoord;

uniform sampler2D u_texture;

void main() {
  gl_FragColor = texture2D(u_texture, v_texcoord);
}
`;

(() => {
  const canvas = document.getElementById('rendering-canvas');
  const gl = canvas.getContext('webgl', { antialias: true });
  // const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  const agentProgramInfo = twgl.createProgramInfo(gl, [vsAgents, fsAgents]);
  const fadeProgramInfo = twgl.createProgramInfo(gl, [vsQuad, fsFade]);
  const copyProgramInfo = twgl.createProgramInfo(gl, [vsQuad, fsCopy]);

  /** State */
  const state = {
    playing: true,
  };

  /** An array the size of the full canvas buffer to store our pixel data */
  let pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);

  // Keep the canvas full screen at all times
  function makeCanvasFullScreen() {
    const controlsWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--controls-width')
    );
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth - controlsWidth;

    if (twgl.resizeCanvasToDisplaySize(gl.canvas)) {
      twgl.resizeFramebufferInfo(gl, fadeFrameBuffer1, fadeAttachments);
      twgl.resizeFramebufferInfo(gl, fadeFrameBuffer2, fadeAttachments);
    }

    // Create a new pixel buffer with our new size
    pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  }
  // Resize listener:
  window.addEventListener('resize', makeCanvasFullScreen);
  // Initial set:
  makeCanvasFullScreen();

  /** Agents */
  const agents = [];
  function initAgents() {
    // Generate agents
    for (let i = 0; i < 10000; i++) {
      agents.push({
        x: getRandomNumber(0, canvas.clientWidth),
        y: getRandomNumber(0, canvas.clientHeight),
        rotation: getRandomNumber(0, Math.PI * 2, false),
        headStrong: 0,
      });
    }
  }

  /** Stores the positions of all the dots */
  let agentBufferInfo = null;
  /** -1 to 1 quad buffer */
  const quadBufferInfo = twgl.primitives.createXYQuadBufferInfo(gl);

  // Creates an RGBA/UNSIGNED_BYTE texture and depth buffer framebuffer
  const imgFbi = twgl.createFramebufferInfo(gl);

  // Creates 2 RGBA texture + depth framebuffers
  var fadeAttachments = [
    { format: gl.RGBA, min: gl.NEAREST, max: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE },
    { format: gl.DEPTH_STENCIL },
  ];
  var fadeFrameBuffer1 = twgl.createFramebufferInfo(gl, fadeAttachments);
  var fadeFrameBuffer2 = twgl.createFramebufferInfo(gl, fadeAttachments);

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

          const turnLeft = leftSample.a > rightSample.a;
          const turnRight = rightSample.a > leftSample.a;

          if (turnLeft) {
            // console.log('turn left!');
            // Turn left!
            agent.rotation += 0.5;
            dx = leftDx;
            dy = leftDy;
          } else if (turnRight) {
            // console.log('turn right!');
            // Turn right!
            agent.rotation -= 0.5;
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

    // Fade by copying from frameBuffer1 to with a fade frameBuffer2
    twgl.bindFramebufferInfo(gl, fadeFrameBuffer2);
    gl.useProgram(fadeProgramInfo.program);
    twgl.setBuffersAndAttributes(gl, fadeProgramInfo, quadBufferInfo);
    twgl.setUniforms(fadeProgramInfo, {
      u_texture: fadeFrameBuffer1.attachments[0],
      u_mixAmount: 0.005,
      u_fadeColor: [0, 0, 0, 0],
      u_textureSize: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    });
    twgl.drawBufferInfo(gl, quadBufferInfo, gl.TRIANGLES);

    /** Draw new things to FB2 */
    // Target is FB2
    twgl.bindFramebufferInfo(gl, fadeFrameBuffer2);
    // Put the positions onto the GPU
    if (agentBufferInfo === null) {
      agentBufferInfo = twgl.createBufferInfoFromArrays(gl, {
        position: vertices,
      });
    } else {
      twgl.setAttribInfoBufferFromArray(gl, agentBufferInfo.attribs.position, vertices);
    }
    // Draw the new positions
    gl.useProgram(agentProgramInfo.program);
    twgl.setBuffersAndAttributes(gl, agentProgramInfo, agentBufferInfo);
    // twgl.setUniforms(programInfo, uniforms);
    twgl.drawBufferInfo(gl, agentBufferInfo, gl.POINTS);

    /** Copy FB2 to canvas for final result **/
    twgl.bindFramebufferInfo(gl, null);
    gl.useProgram(copyProgramInfo.program);
    twgl.setBuffersAndAttributes(gl, copyProgramInfo, quadBufferInfo);
    twgl.setUniforms(copyProgramInfo, {
      u_texture: fadeFrameBuffer2.attachments[0],
    });
    twgl.drawBufferInfo(gl, quadBufferInfo, gl.TRIANGLES);

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

    // Swap frame buffers around so next time we use them the other way around
    const temp = fadeFrameBuffer1;
    fadeFrameBuffer1 = fadeFrameBuffer2;
    fadeFrameBuffer2 = temp;
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
