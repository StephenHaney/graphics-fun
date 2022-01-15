const agentSize = 1;
const halfSize = Math.max(1, agentSize / 2);

const vsAgents = `
attribute vec4 position;
attribute vec4 color;

varying vec4 final_color;

void main() {
  gl_Position = position;
  gl_PointSize = ${agentSize}.0;
  final_color = color;
}
`;

const fsAgents = `
precision mediump float;

varying vec4 final_color;

void main() {
  gl_FragColor = final_color;
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
    texture2D(u_texture, v_texcoord + onePixel * vec2(1.0,  1.0))
    ) / 9.0;

  // Fade to transparency
  vec4 mixed_color = mix(blur_color, u_fadeColor, u_mixAmount);

  if (mixed_color.a < 0.04) {
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
  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false });
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

  /** We cache our canvas size to save DOM API costs during frames */
  let canvasWidth = 0;
  let canvasHeight = 0;

  // Keep the canvas full screen at all times
  function makeCanvasFullScreen() {
    const controlsWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--controls-width')
    );
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth - controlsWidth;
    canvasWidth = canvas.width;
    canvasHeight = canvas.height;

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
  const SETTINGS = {
    sensorDistance: 50,
    sensorAngle: 1,
    turnAngle: 0.7,
    fade: 0.005,
    /** Agents will prefer to stay on their current path over turning, this is an alpha amount to boost the center sensor */
    preferenceToCenter: 0.3,
  };

  const agents = [];
  const colors = [];
  function initAgents() {
    // Generate agents
    const agentCount = 30_000;
    const halfCount = agentCount / 2;

    for (let i = 0; i < agentCount; i++) {
      const rotation = getRandomNumber(0, Math.PI * 2, false);
      // agents.push({
      //   x: getRandomNumber(0, canvasWidth),
      //   y: getRandomNumber(0, canvasHeight),
      //   rotation,
      //   dx: Math.cos(rotation),
      //   dy: Math.sin(rotation),
      //   headstrong: 0,
      // });

      // agents.push({
      //   x: canvasWidth / 2,
      //   y: canvasHeight / 2,
      //   rotation,
      //   dx: Math.cos(rotation),
      //   dy: Math.sin(rotation),
      //   headstrong: 0,
      // });

      if (i < halfCount) {
        colors.push(0.1, 0.2, 0.9, 1);

        agents.push({
          x: canvasWidth / 2,
          y: canvasHeight / 2,
          rotation,
          dx: Math.cos(rotation),
          dy: Math.sin(rotation),
          headstrong: 0,
        });
      } else {
        colors.push(0.1, 0.4, 0.95, 1);

        agents.push({
          x: getRandomNumber(0, canvasWidth),
          y: getRandomNumber(0, canvasHeight),
          rotation,
          dx: Math.cos(rotation),
          dy: Math.sin(rotation),
          headstrong: 0,
        });
      }
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

  function update(time) {
    requestAnimationFrame(update);
    if (!state.playing) {
      return;
    }

    const vertices = [];

    updateAgents(vertices);
    draw(vertices);
  }

  function updateAgents(vertices) {
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];

      if (agent.headstrong > 0) {
        agent.headstrong -= 1;
        // Move forward
        agent.x += agent.dx;
        agent.y += agent.dy;
      } else {
        // Sample ahead for steering
        const leftDx = Math.cos(agent.rotation + SETTINGS.sensorAngle);
        const leftDy = Math.sin(agent.rotation + SETTINGS.sensorAngle);
        const rightDx = Math.cos(agent.rotation - SETTINGS.sensorAngle);
        const rightDy = Math.sin(agent.rotation - SETTINGS.sensorAngle);

        const centerSample = getPixelFromPoint(
          agent.x + agent.dx * SETTINGS.sensorDistance,
          agent.y + agent.dy * SETTINGS.sensorDistance
        );
        const leftSample = getPixelFromPoint(
          agent.x + leftDx * SETTINGS.sensorDistance,
          agent.y + leftDy * SETTINGS.sensorDistance
        );
        const rightSample = getPixelFromPoint(
          agent.x + rightDx * SETTINGS.sensorDistance,
          agent.y + rightDy * SETTINGS.sensorDistance
        );

        if (
          leftSample[3] > rightSample[3] &&
          leftSample[3] > centerSample[3] + SETTINGS.preferenceToCenter
        ) {
          // Turn left!
          agent.rotation += SETTINGS.turnAngle;
          agent.x += leftDx;
          agent.y += leftDy;
          agent.dx = leftDx;
          agent.dy = leftDy;
        } else if (
          rightSample[3] > leftSample[3] &&
          rightSample[3] > centerSample[3] + SETTINGS.preferenceToCenter
        ) {
          // Turn right!
          agent.rotation -= SETTINGS.turnAngle;
          agent.x += rightDx;
          agent.y += rightDy;
          agent.dx = rightDx;
          agent.dy = rightDy;
        } else {
          // Move forward
          agent.x += agent.dx;
          agent.y += agent.dy;
        }
      }

      // Flip X if it hits bounds
      if (agent.x - halfSize <= 0) {
        // Flip the dx and calculate it in radians
        agent.x = halfSize;
        agent.dx = -agent.dx;
        agent.rotation = Math.atan2(agent.dy, agent.dx);
      } else if (agent.x + halfSize >= canvasWidth) {
        // Flip the dx and calculate it in radians
        agent.x = canvasWidth - halfSize;
        agent.dx = -agent.dx;
        agent.rotation = Math.atan2(agent.dy, agent.dx);
      }

      // Flip Y if it hits bounds
      if (agent.y - halfSize <= 0) {
        // Flip the dy and calculate it in radians
        agent.y = halfSize;
        agent.dy = -agent.dy;
        agent.rotation = Math.atan2(agent.dy, agent.dx);
      } else if (agent.y + halfSize >= canvasHeight) {
        // Flip the dy and calculate it in radians
        agent.y = canvasHeight - halfSize;
        agent.dy = -agent.dy;
        agent.rotation = Math.atan2(agent.dy, agent.dx);
      }

      // Push WebGL clipspace vertices
      const xToClip = (agent.x / canvasWidth) * 2 - 1;
      const yToClip = (agent.y / canvasHeight) * 2 - 1;
      vertices.push(xToClip, yToClip, 1);
    }
  }

  function draw(vertices) {
    // Fade by copying from frameBuffer1 to with a fade frameBuffer2
    twgl.bindFramebufferInfo(gl, fadeFrameBuffer2);
    gl.useProgram(fadeProgramInfo.program);
    twgl.setBuffersAndAttributes(gl, fadeProgramInfo, quadBufferInfo);
    twgl.setUniforms(fadeProgramInfo, {
      u_texture: fadeFrameBuffer1.attachments[0],
      u_mixAmount: SETTINGS.fade,
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
        color: colors,
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

  /** Kick it all off */
  initAgents();
  requestAnimationFrame(update);

  /** Click splatter */
  canvas.addEventListener('pointerdown', (e) => {
    const pointerX = e.x - canvas.offsetLeft;
    const pointerY = canvasHeight - (e.y - canvas.offsetTop);

    for (const agent of agents) {
      const distanceX = Math.abs(agent.x - pointerX);
      const distanceY = Math.abs(agent.y - pointerY);
      if (distanceX < 80 && distanceY < 80) {
        agent.rotation = getRandomNumber(0, Math.PI * 2, false);
        agent.headstrong = 300;
      }
    }
  });

  /** Controls */
  // Play/pause
  const playPauseBtn = document.getElementById('btn-play-pause');
  playPauseBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    playPauseBtn.innerText = state.playing ? 'Pause' : 'Play';
  });

  // Sensor Distance
  const sensorDistanceInput = document.getElementById('input-sensor-distance');
  sensorDistanceInput.value = SETTINGS.sensorDistance;
  sensorDistanceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      SETTINGS.sensorDistance = Number.parseFloat(e.target.value);
    }
  });

  // Sensor Angle
  const sensorAngleInput = document.getElementById('input-sensor-angle');
  sensorAngleInput.value = SETTINGS.sensorAngle;
  sensorAngleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      SETTINGS.sensorAngle = Number.parseFloat(e.target.value);
    }
  });

  // Turning angle
  const turnAngleInput = document.getElementById('input-turn-angle');
  turnAngleInput.value = SETTINGS.turnAngle;
  turnAngleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      console.log(Number.parseFloat(e.target.value));
      SETTINGS.turnAngle = Number.parseFloat(e.target.value);
    }
  });

  // Fade time
  const fadeInput = document.getElementById('input-fade');
  fadeInput.value = SETTINGS.fade;
  fadeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      SETTINGS.fade = Number.parseFloat(e.target.value);
    }
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
    return [
      pixels[index] || 0,
      pixels[index + 1] || 0,
      pixels[index + 2] || 0,
      pixels[index + 3] || 0,
    ];
  }
})();

function getRandomNumber(min, max, round = true) {
  const result = Math.random() * (max - min) + min;
  return round ? Math.round(result) : result;
}
