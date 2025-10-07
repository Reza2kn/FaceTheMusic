# Face The Music

Face The Music is a browser-based rhythm game prototype that you can play using facial expressions. Head tilts and mouth movements are translated into lane changes for the in-game orb, keeping everything as accessible as possible.

## Features

- **Face-controlled gameplay** powered by MediaPipe Face Mesh and WebRTC camera input.
- **Three.js visualizer** with animated platforms that sweep toward the player in sync with the beat.
- **Keyboard fallback** so anyone can test the track without a camera.
- **Calibration workflow** to personalise controls for different mobility ranges.

## Getting started

1. Place your audio file in the project directory as `track.mp3` (or edit the `src` of the `<audio>` element in `index.html`).
2. Serve the directory with any static web server. For example:

   ```bash
   npx http-server .
   ```

3. Open the served URL in a browser that supports WebGL and camera access (Chrome, Edge, or Firefox recommended).
4. Allow camera permissions, follow the calibration prompts, and hit **Start Game** when you are ready to bounce along the beat.

Press **R** at any time to recalibrate, or use the keyboard (`W`/`A`/`S`/`D` or arrow keys) if you prefer manual controls.

## Development notes

- The platform timing pattern lives in `src/main.js` inside `createPlatformSequence`. Tweak the timings or pattern to match your chosen track.
- Three.js and MediaPipe are loaded from CDN. An internet connection is required for the first load.
- The project is intentionally build-step free; edit the HTML/CSS/JS directly and refresh the browser to test changes.
