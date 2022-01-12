(() => {
  const agents = [];
  const canvas = document.getElementById('rendering-canvas');
  const ctx = canvas.getContext('2d');

  // Keep the canvas full screen at all times
  function makeCanvasFullScreen() {
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth;
  }
  // Resize listener:
  window.addEventListener('resize', makeCanvasFullScreen);
  // Initial set:
  makeCanvasFullScreen();

  function init() {
    // Generate agents
    for (let i = 0; i < 100; i++) {
      agents.push({
        x: getRandomInt(0.1, canvas.clientWidth),
        y: getRandomInt(0.1, canvas.clientHeight),
        rotation: getRandomInt(0, Math.PI * 2),
        radius: 20,
      });
    }
  }

  function draw() {
    const imgData = ctx.getImageData(0, 0, canvas.clientWidth, canvas.clientHeight);

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    ctx.fillStyle = '#222255';
    for (const agent of agents) {
      // console.log(getPixelFromPoint(imgData, agent.x + 20, agent.y + 20));

      // Draw the agent
      ctx.beginPath();
      ctx.arc(agent.x, agent.y, agent.radius, 0, 2 * Math.PI);
      ctx.fill();

      let dx = Math.cos(agent.rotation);
      let dy = Math.sin(agent.rotation);

      // Sample ahead for steering
      const centerSample = getPixelFromPoint(
        imgData,
        agent.x + dx * 50,
        agent.y + dy * 50
      );
      if (centerSample.a === 0) {
        // Center is negative, check the sides
        const leftDx = Math.cos(agent.rotation - 1);
        const leftDy = Math.sin(agent.rotation - 1);
        const leftSample = getPixelFromPoint(
          imgData,
          agent.x + leftDx * 50,
          agent.y + leftDy * 50
        );
        const rightDx = Math.cos(agent.rotation + 1);
        const rightDy = Math.sin(agent.rotation + 1);
        const rightSample = getPixelFromPoint(
          imgData,
          agent.x + rightDx * 50,
          agent.y + rightDy * 50
        );

        if (leftSample.a !== 0) {
          // Turn left!
          agent.rotation -= 1;
          dx = leftDx;
          dy = leftDy;
        } else if (rightSample.a !== 0) {
          // Turn right!
          agent.rotation += 1;
          dx = rightDx;
          dy = rightDy;
        }
      }

      // Move forward
      agent.x += dx;
      agent.y += dy;

      // Flip X if it hits bounds
      if (agent.x - agent.radius < 0) {
        agent.x = agent.radius;
        agent.rotation += Math.PI;
      } else if (agent.x + agent.radius > canvas.clientWidth) {
        agent.x = canvas.clientWidth - agent.radius;
        agent.rotation += Math.PI;
      }

      // Flip Y if it hits bounds
      if (agent.y - agent.radius < 0) {
        agent.y = agent.radius;
        agent.rotation += Math.PI;
      } else if (agent.y + agent.radius > canvas.clientHeight) {
        agent.y = canvas.clientHeight - agent.radius;
        agent.rotation += Math.PI;
      }
    }
    ctx.fill();

    requestAnimationFrame(draw);
  }

  init();
  requestAnimationFrame(draw);
})();

function getRandomInt(min, max, round = true) {
  min = Math.ceil(min);
  max = Math.floor(max);

  const result = Math.random() * (max - min + 1) + min;
  return round ? Math.floor(result) : result;
}

function getPixelFromPoint(imgData, x, y) {
  const index = (Math.floor(y) * imgData.width + Math.floor(x)) * 4;
  const data = imgData.data;
  return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] };
}
