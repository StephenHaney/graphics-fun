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
uniform vec2 u_textureSize;

void main() {
  vec2 onePixel = 1.0 / u_textureSize;

  vec4 sum = vec4(0, 0, 0, 1);
  float colorCount = 0.0;

  // First do a 3x3 blur
  for (float x = -1.0; x <= 1.0; x += 1.0) {
    for (float y = -1.0; y <= 1.0; y += 1.0) {
      vec2 samplePos = v_texcoord + vec2(x * onePixel.x, y * onePixel.y);
      sum += texture2D(u_texture, samplePos);
      colorCount += 1.0;
    }
  }
  vec4 blurColor = vec4(sum / colorCount);

  // The actual color from this coordinate
  vec4 ownColor = texture2D(u_texture, v_texcoord);
  vec4 mixedColor = mix(mix(ownColor, blurColor, 0.5), vec4(0, 0, 0, 1), 0.007) - 0.003;

  gl_FragColor = mixedColor;
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
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
  });
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

  /** Stores the positions of all the dots */
  let agentBufferInfo = null;
  /** -1 to 1 quad buffer */
  const quadBufferInfo = twgl.primitives.createXYQuadBufferInfo(gl);

  // Creates 2 RGBA texture + depth framebuffers, we draw to these and ping pong back and forth to fade all pixels to black
  // So say we last drew to buffer2... draw buffer2 to buffer1 with a reduction towards black... then draw new stuff on buffer1... then draw buffer1 to canvas
  // Next time we'll draw buffer1 to buffer2 with a fade to black, draw new things to buffer2, draw buffer2 to canvas, etc etc
  let fadeAttachments = [
    { format: gl.RGBA, min: gl.NEAREST, max: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE },
    { format: gl.DEPTH_STENCIL },
  ];
  let fadeFrameBuffer1 = twgl.createFramebufferInfo(gl, fadeAttachments);
  let fadeFrameBuffer2 = twgl.createFramebufferInfo(gl, fadeAttachments);

  /** We cache our canvas size to save DOM API costs during frames */
  let canvasWidth = 0;
  let canvasHeight = 0;

  // Keep the canvas full screen at all times
  function makeCanvasFullScreen() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Resize the fade buffers with the new size
    twgl.resizeFramebufferInfo(gl, fadeFrameBuffer1, fadeAttachments);
    twgl.resizeFramebufferInfo(gl, fadeFrameBuffer2, fadeAttachments);

    // Create a new pixel buffer with our new size
    pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);

    // Cache the sizes for fast usage
    canvasWidth = canvas.width;
    canvasHeight = canvas.height;
  }
  // Resize listener:
  window.addEventListener('resize', makeCanvasFullScreen);
  // Initial set:
  makeCanvasFullScreen();

  /** Agents */
  const SETTINGS = {
    sensorDistance: 40,
    sensorAngle: 0.9,
    turnAngle: 0.9,
    /** Agents will prefer to stay on their current path over turning, this is an alpha amount to boost the center sensor */
    preferenceToCenter: 0.8,
    defaultColor: [0.6, 0.6, 1, 1],
    playSpeed: 2,
  };

  const agents = [];
  const colors = [];
  function initAgents() {
    // Generate agents
    const agentCount = 40_000;
    const halfCount = agentCount / 2;

    for (let i = 0; i < agentCount; i++) {
      const rotation = getRandomNumber(0, Math.PI * 2, false);

      if (i < halfCount) {
        colors.push(...SETTINGS.defaultColor);
        agents.push({
          x: canvasWidth / 2,
          y: canvasHeight / 2,
          rotation,
          dx: Math.cos(rotation),
          dy: Math.sin(rotation),
          headstrong: 150,
        });
      } else {
        colors.push(...SETTINGS.defaultColor);
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

  function update(time) {
    requestAnimationFrame(update);

    if (!state.playing) {
      return;
    }

    const vertices = [];

    updateAgents(vertices);
    draw(vertices);
  }

  /** Once a frame we shoot an agent off in a random direction */
  let luckyMutationIndex = 0;
  function updateAgents(vertices) {
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];

      if (i === luckyMutationIndex) {
        luckyMutationIndex = getRandomNumber(0, agents.length);
        // Randomly pick a new direction
        agent.rotation = getRandomNumber(0, Math.PI * 2, false);
        agent.dx = Math.cos(agent.rotation);
        agent.dy = Math.sin(agent.rotation);
        agent.x += agent.dx * SETTINGS.playSpeed;
        agent.y += agent.dy * SETTINGS.playSpeed;
        agent.headstrong = 30;
      } else if (agent.headstrong > 0) {
        agent.headstrong -= 1;
        // Move forward
        agent.x += agent.dx * SETTINGS.playSpeed;
        agent.y += agent.dy * SETTINGS.playSpeed;
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
          leftSample[2] > rightSample[2] &&
          leftSample[2] > centerSample[2] + SETTINGS.preferenceToCenter
        ) {
          // Turn left!
          agent.rotation += SETTINGS.turnAngle;
          agent.x += leftDx * SETTINGS.playSpeed;
          agent.y += leftDy * SETTINGS.playSpeed;
          agent.dx = leftDx;
          agent.dy = leftDy;
          // agent.headstrong = 10;
        } else if (
          rightSample[2] > leftSample[2] &&
          rightSample[2] > centerSample[2] + SETTINGS.preferenceToCenter
        ) {
          // Turn right!
          agent.rotation -= SETTINGS.turnAngle;
          agent.x += rightDx * SETTINGS.playSpeed;
          agent.y += rightDy * SETTINGS.playSpeed;
          agent.dx = rightDx;
          agent.dy = rightDy;
          // agent.headstrong = 10;
        } else {
          // Move forward
          agent.x += agent.dx * SETTINGS.playSpeed;
          agent.y += agent.dy * SETTINGS.playSpeed;
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
        agent.dx = Math.cos(agent.rotation);
        agent.dy = Math.sin(agent.rotation);
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
      SETTINGS.turnAngle = Number.parseFloat(e.target.value);
    }
  });

  // Color
  const color1Input = document.getElementById('input-color-1');
  color1Input.value = SETTINGS.defaultColor.join(' ');
  color1Input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const colorArray = e.target.value.split(' ').map((str) => Number.parseFloat(str));
      SETTINGS.defaultColor = colorArray;

      // Update and push the color buffer
      for (let i = 0; i < colors.length; i++) {
        colors[i] = colorArray[i % 4];
      }
      twgl.setAttribInfoBufferFromArray(gl, agentBufferInfo.attribs.color, colors);
    }
  });

  // Play speed
  const speedInput = document.getElementById('input-speed');
  speedInput.value = SETTINGS.playSpeed;
  speedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      SETTINGS.playSpeed = Number.parseFloat(e.target.value);
    }
  });

  // Show/Hide Controls
  const showControlsBtn = document.getElementById('btn-show-controls');
  showControlsBtn.addEventListener('click', () => {
    document.body.classList.add('showing-controls');
  });
  const hideControlsBtn = document.getElementById('btn-hide-controls');
  hideControlsBtn.addEventListener('click', () => {
    document.body.classList.remove('showing-controls');
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

console.log(
  '%cHello there! Welcome to Physarum.',
  'font-size: 24px; background-color: #222; color: #6688cc'
);
console.log(
  '%cCreated by Stephen Haney in January 2022',
  'background-color: #222; color: #fff;'
);
