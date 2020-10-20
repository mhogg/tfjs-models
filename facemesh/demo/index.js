/**
 * @license
 * Copyright 2020 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as facemesh from '@tensorflow-models/facemesh';
import Stats from 'stats.js';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';

import { TRIANGULATION } from './triangulation';
import { Log, tensor2d } from '@tensorflow/tfjs-core';
import { TLSSocket } from 'tls';

import * as ms from './mask_sizing_tool';
import { MovingAverage, LogMeasurements } from './utils';


// socket IO
const socket = io();

tfjsWasm.setWasmPaths(
  `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${tfjsWasm.version_wasm}/dist/`);

const NUM_KEYPOINTS = 468;
const GREEN = '#32EEDB';
const RED = "#FF2C35";
const BLUE = "#0000FF";
const WHITE = "#FFFFFF";

// Landmark lists
const MESH_ANNOTATIONS = facemesh.FaceMesh.getAnnotations();
const LANDMARKS = {
  infraorb_L: 330,
  infraorb_R: 101,
  nose_alar_L: 278,             // For nose width
  nose_alar_R: 48,              // For nose width
  nose_alarfacialgroove_L: 358, // For nose depth
  nose_alarfacialgroove_R: 129, // For nose depth
  nose_tip: 4,                  // For nose depth
  sellion: 168,
  supramenton: 200,
  tragion_L: 454,
  tragion_R: 234
};

// Log measurements
var logMeasurementsv1 = new LogMeasurements(socket, 1000);
document.getElementById("scanButton").onclick = function() {logMeasurementsv1.initialise()};
var logMeasurementsv2 = new LogMeasurements(socket, 1000);
document.getElementById("scanButton").onclick = function() {logMeasurementsv2.initialise()};

// Moving averages
var headMeasuresv1Avg = {};
var headMeasuresv2Avg = {};
['noseWidth', 'noseDepth', 'faceHeight', 'faceWidth'].forEach(name => {
  headMeasuresv1Avg[name] = new MovingAverage();
  headMeasuresv2Avg[name] = new MovingAverage();
});

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

function drawPath(ctx, points, closePath) {
  const region = new Path2D();
  region.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    region.lineTo(point[0], point[1]);
  }

  if (closePath) {
    region.closePath();
  }
  ctx.stroke(region);
}

let model, ctx, videoWidth, videoHeight, video, canvas,
  scatterGLHasInitialized = false, scatterGL, rafID;

const VIDEO_SIZE = [500, 750]; // (w x h)
const mobile = isMobile();
// Don't render the point cloud on mobile in order to maximize performance and
// to avoid crowding limited screen space.
//const renderPointcloud = mobile === false;
//const renderPointcloud = false; // Turn off for testing
const stats = new Stats();
const state = {
  backend: 'webgl',
  maxFaces: 1,
  triangulateMesh: false,
  predictIrises: true
};

//if (renderPointcloud) {
//  state.renderPointcloud = true;
//}

function setupDatGui() {
  const gui = new dat.GUI();
  gui.add(state, 'backend', ['webgl', 'wasm', 'cpu'])
    .onChange(async backend => {
      window.cancelAnimationFrame(rafID);
      await tf.setBackend(backend);
      requestAnimationFrame(run);
    });

  //gui.add(state, 'maxFaces', 1, 20, 1).onChange(async val => {
  //  model = await facemesh.load({ maxFaces: val });
  //});

  gui.add(state, 'triangulateMesh');
  //gui.add(state, 'predictIrises');

  //if (renderPointcloud) {
  //  gui.add(state, 'renderPointcloud').onChange(render => {
  //    document.querySelector('#scatter-gl-container').style.display =
  //      render ? 'inline-block' : 'none';
  //  });
  //}
}

async function setupCamera() {
  video = document.getElementById('video');

  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      // Only setting the video to a specified size in order to accommodate a
      // point cloud, so on mobile devices accept the default size.
      width: mobile ? undefined : VIDEO_SIZE[0],
      height: mobile ? undefined : VIDEO_SIZE[1]
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

function plotCircle(lmrk, colour = BLUE, radius = 3) {
  // Plot a circle to represent landmarks
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.arc(lmrk.x, lmrk.y, radius, 0, 2 * Math.PI);
  ctx.fill();
}

function plotEllipse(center, diameter, colour = RED, lineWidth = 1) {
  // Plot an ellipse to represent the iris outer boundary
  let radius = diameter / 2;
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, radius, radius, 0, 0, 2 * Math.PI);
  ctx.stroke();
}

function plotIrises(lmrks, irisMeasures, color=RED) {
  // Plot iris points
  ['left', 'right'].forEach(direction => {
    lmrks[`${direction}EyeIris`].forEach(p => {
      plotCircle(p, color, 2);
    });
  });
  // Plot ellipses representing boundary of each iris
  ['left', 'right'].forEach(direction => {
    let irisCentre = lmrks[`${direction}EyeIris`][0];
    let irisDiam = irisMeasures[`iris_diam_${direction}`];
    plotEllipse(irisCentre, irisDiam, color);
  });
}

function plotLandmarks(lmrks) {
  
  // Assign a color to each landmark 
  let lmrkColors = [
    [BLUE,  ['infraorb_L', 'infraorb_R', 'sellion', 'supramenton']],
    [GREEN, ['nose_alar_L', 'nose_alar_R']],
    [RED,   ['tragion_L', 'tragion_R']],
    [WHITE, ['nose_alarfacialgroove_L', 'nose_alarfacialgroove_R', 'nose_tip']]];

  // Plot each landmark
  lmrkColors.forEach(entry => {
    let [color, lmrkList] = entry;
    lmrkList.forEach(lm => {
      plotCircle(lmrks[lm], color);
    });
  });
}

function renderFacemesh(keypoints) {

  // Display the face mesh (points or triangulated mesh) superimposed
  // over the face in the video feed

  if (state.triangulateMesh) {

    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 0.5;

    for (let i = 0; i < TRIANGULATION.length / 3; i++) {
      const points = [
        TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
        TRIANGULATION[i * 3 + 2]
      ].map(index => keypoints[index]);
      drawPath(ctx, points, true);
    }

  } else {

    ctx.fillStyle = GREEN;

    for (let i = 0; i < NUM_KEYPOINTS; i++) {
      const x = keypoints[i][0];
      const y = keypoints[i][1];

      ctx.beginPath();
      ctx.arc(x, y, 1, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

async function run() {

  stats.begin();
  
  const predictions = await model.estimateFaces(
    video, false, false, state.predictIrises);

  ctx.drawImage(
    video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);

  if (predictions.length > 0) { // Should only have 1 face

    // Display mesh and irises
    predictions.forEach(prediction => {

      // Get the unscaled and scaled meshes
      const mesh = prediction.mesh;
      const scaledMesh = prediction.scaledMesh;

      // Check if mesh contains iris points
      let has_iris = scaledMesh.length > NUM_KEYPOINTS;

      // Get coordinates of all landmark points and put in array or object
      let lcm  = ms.getLandmarkCoordinates(mesh, LANDMARKS, MESH_ANNOTATIONS, false); // Bug - Mesh does not have iris points
      let lcsm = ms.getLandmarkCoordinates(scaledMesh, LANDMARKS, MESH_ANNOTATIONS, has_iris);

      // Render the face mesh (points or triangulated mesh) and plot landmarks
      renderFacemesh(scaledMesh);
      plotLandmarks(lcsm);

      // Get head orientation (could use mesh or scaledMesh)
      let [eulerAngles, headPlanes] = ms.getHeadPose(lcsm);
      // Update head pose values in html
      ms.updateHeadPoseValues(eulerAngles);

      // Get iris diameter data
      let irisMeasures = has_iris ? ms.getIrisMeasures(lcsm) : null;
      if (irisMeasures) {
        plotIrises(lcsm, irisMeasures);
      }

      // Head measurements v1 - Raw mesh data from facemesh model
      // --------------------------------------------------------
      let headMeasuresv1 = ms.getHeadMeasures(lcm);
      let colIndexv1 = 1;
      ms.updateHeadMeasureValues(headMeasuresv1, "unfiltered", colIndexv1);

      // Log data
      logMeasurementsv1.appendData([eulerAngles, headMeasuresv1, irisMeasures]);

      // Update time averaged values and add to html
      for (const [key, value] of Object.entries(headMeasuresv1)) {
        headMeasuresv1Avg[key].update(value);
      }
      let filtered_v1 = {}
      for (const [k,v] of Object.entries(headMeasuresv1Avg)) {
        filtered_v1[k] = v.average();
      }
      ms.updateHeadMeasureValues(filtered_v1, "filtered", colIndexv1);

      // Add mask size recommendation
      let mask_sizes_v1 = ms.getMaskSizes(filtered_v1);
      ms.updateMaskSizeRecommend(mask_sizes_v1, "mask-size-recommend", colIndexv1);


      // Head measurements v2 - scaledMesh scaled using iris diameter
      // ------------------------------------------------------------
      let headMeasuresv2 = ms.getHeadMeasures(lcsm);
      if (irisMeasures) {
        for (const [key, value] of Object.entries(headMeasuresv2)) {
          headMeasuresv2[key] = value * irisMeasures.iris_diam_scale;
        }
      }
      let colIndexv2 = 2;
      ms.updateHeadMeasureValues(headMeasuresv2, "unfiltered", colIndexv2);
      
      // Log data
      logMeasurementsv2.appendData([eulerAngles, headMeasuresv2, irisMeasures]);

      // Update time averaged values and add to html
      for (const [key, value] of Object.entries(headMeasuresv2)) {
        headMeasuresv2Avg[key].update(value);
      }
      let filtered_v2 = {}
      for (const [k,v] of Object.entries(headMeasuresv2Avg)) {
        filtered_v2[k] = v.average();
      }
      ms.updateHeadMeasureValues(filtered_v2, "filtered", colIndexv2);

      // Add mask size recommendation
      let mask_sizes_v2 = ms.getMaskSizes(filtered_v2);
      ms.updateMaskSizeRecommend(mask_sizes_v2, "mask-size-recommend", colIndexv2);

      /*
      // Head measurements v3 - Same as v2, but uses alternative method for nose Depth
      // -----------------------------------------------------------------------------

      let scaleFactor = irisMeasures != null ? irisMeasures.scale : 1.0;
      scaleFactor *= scaleFactorv3;
      let noseWidth = getNoseWidth(scaledMesh, headPlanes, scaleFactor);
      let faceWidth = getFaceWidth(scaledMesh, headPlanes, scaleFactor);
      let noseDepth = getNoseDepth(scaledMesh, headPlanes, scaleFactor);

      let noseDepthDiag = noseDepth;
      if (noseDepth) {
        noseDepthDiag = Math.sqrt(Math.pow(noseWidth / 2.0, 2) + Math.pow(noseDepth, 2));
      }

      let faceHeight = 0;
      let headMeasuresv3 = {
        'noseWidth' : noseWidth,
        'noseDepth' : noseDepthDiag,
        'faceHeight': faceHeight,
        'faceWidth' : faceWidth
      }
      // Update html with head measures and iris measures
      updateHeadMeasureValues(headMeasuresv3, "unfiltered", 3);

      // Update time averaged
      for (const [key, value] of Object.entries(headMeasuresv3)) {
        if (value != null) {
          movingAverage_headMeasuresv3[key].update(value);
        }
      }
      let filtered_v3 = {
        'noseWidth' : movingAverage_headMeasuresv3.noseWidth.average(),
        'noseDepth' : movingAverage_headMeasuresv3.noseDepth.average(),
        'faceHeight': movingAverage_headMeasuresv2.faceHeight.average(), // Use v2
        'faceWidth' : movingAverage_headMeasuresv2.faceWidth.average()   // Use v2
      }
      updateHeadMeasureValues(filtered_v3, "filtered", 3);

      // Add mask size recommendation
      let fh3 = movingAverage_headMeasuresv2.faceHeight.average(); // Use v2
      let nw3 = movingAverage_headMeasuresv3.noseWidth.average();
      let nd3 = movingAverage_headMeasuresv3.noseDepth.average();
      let mask_sizes_v3 = {
        'F20' : mask_sizer_F20(fh3),
        'F30' : mask_sizer_F30(nw3, nd3),
        'F30i': mask_sizer_F30i(nw3, nd3),
        'N20' : mask_sizer_N20(nw3),
        'N30i': mask_sizer_N30i(nw3, nd3)
      }
      updateMaskSizeRecommend(mask_sizes_v3, "mask-size-recommend", 3);
      */
    });
  }
  stats.end();
  rafID = requestAnimationFrame(run);
};

async function main() {

  await tf.setBackend(state.backend);
  setupDatGui();

  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);

  await setupCamera();
  video.play();
  videoWidth = video.videoWidth;
  videoHeight = video.videoHeight;
  video.width = videoWidth;
  video.height = videoHeight;

  canvas = document.getElementById('output');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const canvasContainer = document.querySelector('.canvas-wrapper');
  canvasContainer.style = `width: ${videoWidth}px; height: ${videoHeight}px`;

  ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = GREEN;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 0.5;

  model = await facemesh.load({ maxFaces: state.maxFaces });
  run();
};

main();
