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
import * as THREE from 'three';

import { TRIANGULATION } from './triangulation';
import { Log, tensor2d } from '@tensorflow/tfjs-core';
import { TLSSocket } from 'tls';

import * as ms from './mask_sizing_tool';
import { MovingAverage, average, distanceXY, LogMeasurements } from './utils';
import { mask_sizer_F20, mask_sizer_F30, mask_sizer_F30i, mask_sizer_N20, mask_sizer_N30i } from './mask_sizing';

ms.myFunction();

// socket IO
const socket = io();

tfjsWasm.setWasmPaths(
  `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${tfjsWasm.version_wasm}/dist/`);

const NUM_KEYPOINTS = 468;
const NUM_IRIS_KEYPOINTS = 5;
const GREEN = '#32EEDB';
const RED = "#FF2C35";
const BLUE = "#0000FF";
const WHITE = "#FFFFFF";

// Iris scaling
const scaleFactorv2 = 1.05;
const scaleFactorv3 = 1.05;
const IRIS_DIAMETER_AVGERAGE = 11.7;

const MESH_ANNOTATIONS = facemesh.FaceMesh.getAnnotations();

// Landmark list
const LMRK = {
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

// Physical dimension ranges (from mask_sizing.js fit ranges)
var physicalRanges = {
  'noseWidth' : { 'min': 23, 'max':  55 },
  'noseDepth' : { 'min': 16, 'max':  39 },
  'faceHeight': { 'min': 74, 'max': 110 },
  'faceWidth' : { 'min': 0,  'max': 200 } // No reference
}

// Moving averages
var movingAverage_headMeasuresv1 = {
  'noseWidth' : new MovingAverage(),
  'noseDepth' : new MovingAverage(),
  'faceHeight': new MovingAverage(),
  'faceWidth' : new MovingAverage()
};

var movingAverage_headMeasuresv2 = {
  'noseWidth' : new MovingAverage(),
  'noseDepth' : new MovingAverage(),
  'faceHeight': new MovingAverage(),
  'faceWidth' : new MovingAverage()
};

var movingAverage_headMeasuresv3 = {
  'noseWidth' : new MovingAverage(),
  'noseDepth' : new MovingAverage(),
  'faceHeight': new MovingAverage(),
  'faceWidth' : new MovingAverage()
};

var logMeasurements = new LogMeasurements(socket, 1000);
document.getElementById("scanButton").onclick = function() {logMeasurements.initialise()};

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
const renderPointcloud = false; // Turn off for testing
const stats = new Stats();
const state = {
  backend: 'webgl',
  maxFaces: 1,
  triangulateMesh: false,
  predictIrises: true
};

if (renderPointcloud) {
  state.renderPointcloud = true;
}

function setupDatGui() {
  const gui = new dat.GUI();
  gui.add(state, 'backend', ['webgl', 'wasm', 'cpu'])
    .onChange(async backend => {
      window.cancelAnimationFrame(rafID);
      await tf.setBackend(backend);
      requestAnimationFrame(run);
    });

  gui.add(state, 'maxFaces', 1, 20, 1).onChange(async val => {
    model = await facemesh.load({ maxFaces: val });
  });

  gui.add(state, 'triangulateMesh');
  gui.add(state, 'predictIrises');

  if (renderPointcloud) {
    gui.add(state, 'renderPointcloud').onChange(render => {
      document.querySelector('#scatter-gl-container').style.display =
        render ? 'inline-block' : 'none';
    });
  }
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

function createPlaneAtOrigin(mesh, normal) {
  let ptL = new THREE.Vector3().fromArray(mesh[LMRK.tragion_L]);
  let ptR = new THREE.Vector3().fromArray(mesh[LMRK.tragion_R]);
  let p = ptL.clone().lerp(ptR, 0.5);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
}

function headCsysFromPoints(ptL, ptR, piL, piR) {
  // p0 - origin
  let p0 = ptL.clone().lerp(ptR, 0.5);
  // p1 = point on x axis, v1 = x-axis
  let p1 = ptL.clone();
  let v1 = new THREE.Vector3().subVectors(p1, p0).normalize();
  // p2 = point on z axis, v3 = z-axis
  let p2 = piL.clone().lerp(piR, 0.5);
  let v3 = new THREE.Vector3().subVectors(p2, p0).normalize();
  // v2 = y-axis
  let v2 = new THREE.Vector3().crossVectors(v3, v1).normalize();
  // Recalculate v1 to ensure that csys is orthogonal
  v1.crossVectors(v2, v3).normalize();
  // Return matrix representing csys
  let basis = new THREE.Matrix4().makeBasis(v1, v2, v3);
  return new THREE.Matrix3().setFromMatrix4(basis);
}

function headCsysMoving(mesh) {
  // Head coordinate system based on the updated mesh coordinates
  // Landmark coordinates
  let ptL = new THREE.Vector3().fromArray(mesh[LMRK.tragion_L]);
  let ptR = new THREE.Vector3().fromArray(mesh[LMRK.tragion_R]);
  let piL = new THREE.Vector3().fromArray(mesh[LMRK.infraorb_L]);
  let piR = new THREE.Vector3().fromArray(mesh[LMRK.infraorb_R]);
  // Basis matrix
  return headCsysFromPoints(ptL, ptR, piL, piR);
}

function headCsysCanonical() {
  // Head coordinate system based on the fixed mesh coordinates
  // Coordinates from canonical_face_model.obj in mediapipe repo
  let ptL = new THREE.Vector3( 7.66418, 0.673132, -2.43587);  // tragion_L
  let ptR = new THREE.Vector3(-7.66418, 0.673132, -2.43587); // tragion_R
  let piL = new THREE.Vector3( 3.32732, 0.104863,  4.11386);   // infraorb_L
  let piR = new THREE.Vector3(-3.32732, 0.104863,  4.11386);  // infraorb_R
  // To be consistent with the csys coordinate directions of the moving cys,
  // we negate the y and z coords (equiv to a 180 deg rotation about x)
  [ptL, ptR, piL, piR].forEach(p => {  
    [1,2].forEach(i => {
      p.setComponent(i, -p.getComponent(i));
    });
  });
  // Basis matrix
  return headCsysFromPoints(ptL, ptR, piL, piR);
}

function plotIris(center, diameter, colour = RED, lineWidth = 1) {
  let radius = diameter / 2;
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, radius, radius, 0, 0, 2 * Math.PI);
  ctx.stroke();
}

function plotLandmark(lmrk, colour = BLUE, radius = 3) {
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.arc(lmrk.x, lmrk.y, radius, 0, 2 * Math.PI);
  ctx.fill();
}

function getCoordinateVectors(M) {
  let m1 = new THREE.Vector3();
  let m2 = new THREE.Vector3();
  let m3 = new THREE.Vector3();
  M.extractBasis(m1, m2, m3);
  return [m1, m2, m3];
}

function getHeadPose(mesh) {
  // Get fixed and moving csyses
  let F = headCsysCanonical();  // Fixed csys
  let M = headCsysMoving(mesh); // Moving csys
  // Get coordinate vectors
  let [f1, f2, f3] = getCoordinateVectors(F);
  let [m1, m2, m3] = getCoordinateVectors(M);
  // Rotation matrix (4x4)
  let r1 = new THREE.Vector3().set(m1.dot(f1), m1.dot(f2), m1.dot(f3));
  let r2 = new THREE.Vector3().set(m2.dot(f1), m2.dot(f2), m2.dot(f3));
  let r3 = new THREE.Vector3().set(m3.dot(f1), m3.dot(f2), m3.dot(f3));
  let RM = new THREE.Matrix4().makeBasis(r1, r2, r3);
  // Euler angles - User for head pose
  let eulerAnglesRad = new THREE.Euler().setFromRotationMatrix(RM, 'XYZ').toArray();
  let eulerAngles = [];
  for (let i = 0; i < 3; i++) {
    let a = THREE.MathUtils.radToDeg(eulerAnglesRad[i]);
    // NOTE: Correct angles to within -90 to +90 range
    if (a >  90) { a = a - 180; }
    if (a < -90) { a = a + 180; }
    eulerAngles.push(a);
  }
  // Head planes - Used for intersections
  let headPlanes = {
    'frontal'   : createPlaneAtOrigin(mesh, m3),
    'median'    : createPlaneAtOrigin(mesh, m1),
    'transverse': createPlaneAtOrigin(mesh, m2)
  };
  // Return  
  return [eulerAngles, headPlanes];
}

function calculateNoseWidth(mesh, plane, tol = 1.5) {
  let ray_origin_z = 1e+4;
  let ray_direction = new THREE.Vector3(0, 0, -1);
  // Get points
  let pnL = new THREE.Vector3().fromArray(mesh[LMRK.nose_alar_L]);
  let pnR = new THREE.Vector3().fromArray(mesh[LMRK.nose_alar_R]);
  // Ray - nose_L
  let nL_origin = new THREE.Vector3(pnL.x, pnL.y, ray_origin_z);
  let nL_ray = new THREE.Ray(nL_origin, ray_direction);
  // Ray - nose_R
  let nR_origin = new THREE.Vector3(pnR.x, pnR.y, ray_origin_z);
  let nR_ray = new THREE.Ray(nR_origin, ray_direction);
  // Get intersection points
  let noseWidth = null;
  let is_perpendicular = THREE.MathUtils.radToDeg(Math.abs(plane.normal.dot(ray_direction))) < tol;
  if (!is_perpendicular) {
    if ((nL_ray.intersectsPlane(plane)) &&
      (nR_ray.intersectsPlane(plane))) {
      // nose_L
      let nL_intersect = new THREE.Vector3();
      nL_ray.intersectPlane(plane, nL_intersect);
      // nose_R
      let nR_intersect = new THREE.Vector3();
      nR_ray.intersectPlane(plane, nR_intersect);
      // Get 3D distance between intersection points
      noseWidth = nL_intersect.distanceTo(nR_intersect);
    }
  }
  return noseWidth;
}

function calculateNoseDepth(mesh, plane, tol = 1.5) {
  // NOTE: Use either the median or transverse planes for noseDepth
  let ray_origin_z = 1e+6;
  let ray_direction = new THREE.Vector3(0, 0, -1);
  // Get points
  let pnL = new THREE.Vector3().fromArray(mesh[LMRK.nose_alarfacialgroove_L]);
  let pnR = new THREE.Vector3().fromArray(mesh[LMRK.nose_alarfacialgroove_R]);
  let pnT = new THREE.Vector3().fromArray(mesh[LMRK.nose_tip]);
  let pnLRavg = pnL.clone().lerp(pnR, 0.5);
  // Ray - nose tip
  let nT_origin = new THREE.Vector3(pnT.x, pnT.y, ray_origin_z);
  let nT_ray = new THREE.Ray(nT_origin, ray_direction);
  // Ray - nose_LRavg
  let nLRavg_origin = new THREE.Vector3(pnLRavg.x, pnLRavg.y, ray_origin_z);
  let nLRavg_ray = new THREE.Ray(nLRavg_origin, ray_direction);
  // Get intersection points
  let noseDepth = null;
  let is_perpendicular = THREE.MathUtils.radToDeg(Math.abs(plane.normal.dot(ray_direction))) < tol;
  if (!is_perpendicular) {
    if ((nT_ray.intersectsPlane(plane)) &&
      (nLRavg_ray.intersectsPlane(plane))) {
      // nose tip
      let nT_intersect = new THREE.Vector3();
      nT_ray.intersectPlane(plane, nT_intersect);
      // nose_LRavg
      let nLRavg_intersect = new THREE.Vector3();
      nLRavg_ray.intersectPlane(plane, nLRavg_intersect);
      // Get 3D distance between intersection points
      noseDepth = nT_intersect.distanceTo(nLRavg_intersect);
    }
  }
  return noseDepth;
}

function calculateFaceHeight(mesh, plane, tol = 1.5) {
  let ray_origin_z = 1e+6;
  let ray_direction = new THREE.Vector3(0, 0, -1);
  // Get points
  let psel = new THREE.Vector3().fromArray(mesh[LMRK.sellion]);
  let psup = new THREE.Vector3().fromArray(mesh[LMRK.supramenton]);
  //let ptL = new THREE.Vector3().fromArray(mesh[LMRK.tragion_L]);
  //let ptR = new THREE.Vector3().fromArray(mesh[LMRK.tragion_R]);
  //let ptavg = ptL.clone().lerp(ptR, 0.5);
  // Create parallel plane through the tragion average point, then
  // project both psel and psup onto this plane
  let plane_sel = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, psel);
  let projected1 = new THREE.Vector3();
  let projected2 = new THREE.Vector3();
  plane_sel.projectPoint(psel, projected1);
  plane_sel.projectPoint(psup, projected2);
  //plotLandmark(projected1, RED);
  //plotLandmark(projected2, RED);

  //let ray_psel = new THREE.Ray(psel, plane.normal.negate());
  //let ray_psup = new THREE.Ray(psup, plane.normal.negate());
  //console.log(ray_psel.intersectsPlane(plane_tavg));
  //console.log(ray_psup.intersectsPlane(plane_tavg));

  // Ray - Sellion
  let proj1_origin = new THREE.Vector3(projected1.x, projected1.y, ray_origin_z);
  let proj1_ray = new THREE.Ray(proj1_origin, ray_direction);
  // Ray - Supramenton
  let proj2_origin = new THREE.Vector3(projected2.x, projected2.y, ray_origin_z);
  let proj2_ray = new THREE.Ray(proj2_origin, ray_direction);
  // Get intersection points
  let faceHeight = null;
  let is_perpendicular = THREE.MathUtils.radToDeg(Math.abs(plane.normal.dot(ray_direction))) < tol;
  if (!is_perpendicular) {
    if ((proj1_ray.intersectsPlane(plane)) &&
      (proj2_ray.intersectsPlane(plane))) {
      // Sellion
      let sel_intersect = new THREE.Vector3();
      proj1_ray.intersectPlane(plane, sel_intersect);
      // Supramenton
      let sup_intersect = new THREE.Vector3();
      proj2_ray.intersectPlane(plane, sup_intersect);
      // Get 3D distance between intersection points
      faceHeight = sel_intersect.distanceTo(sup_intersect);
    }
  }
  return faceHeight;
}

function calculateFaceWidth(mesh, plane, tol = 1.5) {
  let ray_origin_z = 1e+4;
  let ray_direction = new THREE.Vector3(0, 0, -1);
  // Get points
  let p_tragion_L = new THREE.Vector3().fromArray(mesh[LMRK.tragion_L]);
  let p_tragion_R = new THREE.Vector3().fromArray(mesh[LMRK.tragion_R]);
  // Ray - nose_L
  let tragionL_origin = new THREE.Vector3(p_tragion_L.x, p_tragion_L.y, ray_origin_z);
  let tragionL_ray = new THREE.Ray(tragionL_origin, ray_direction);
  // Ray - nose_R
  let tragionR_origin = new THREE.Vector3(p_tragion_R.x, p_tragion_R.y, ray_origin_z);
  let tragionR_ray = new THREE.Ray(tragionR_origin, ray_direction);
  // Get intersection points
  let faceWidth = null;
  let is_perpendicular = THREE.MathUtils.radToDeg(Math.abs(plane.normal.dot(ray_direction))) < tol;
  if (!is_perpendicular) {
    if ((tragionL_ray.intersectsPlane(plane)) &&
      (tragionR_ray.intersectsPlane(plane))) {
      // tragion_L
      let tragionL_intersect = new THREE.Vector3();
      tragionL_ray.intersectPlane(plane, tragionL_intersect);
      // tragion_R
      let tragionR_intersect = new THREE.Vector3();
      tragionR_ray.intersectPlane(plane, tragionR_intersect);
      // Get 3D distance between intersection points
      faceWidth = tragionL_intersect.distanceTo(tragionR_intersect);
    }
  }
  return faceWidth;
}

function getFaceWidth(mesh, headPlanes, irisScaleFactor) {

  // NOTE: faceWidth_t will not return a value if person is looking straight
  //       ahead. Although faceWidth_f should always return a valid value,
  //       it is only accurate when the person looks straight ahead.

  let faceWidth_f = calculateFaceWidth(mesh, headPlanes.frontal);
  let faceWidth_t = calculateFaceWidth(mesh, headPlanes.transverse);

  var data = [faceWidth_f, faceWidth_t];
  data = data.filter(function (i) { return i != null; });
  let faceWidth = Math.min(...data) * irisScaleFactor;

  return faceWidth;
}

function getNoseWidth(mesh, headPlanes, irisScaleFactor) {

  // NOTE: noseWidth_t will not return a value if person is looking straight
  //       ahead. Although noseWidth_f should always return a valid value,
  //       it is only accurate when the person looks straight ahead.

  let noseWidth_f = calculateNoseWidth(mesh, headPlanes.frontal);
  let noseWidth_t = calculateNoseWidth(mesh, headPlanes.transverse);

  // NOTE: ... is the spread operator. It unpacks an array.
  var data = [noseWidth_f, noseWidth_t];
  data = data.filter(function (i) { return i != null; });
  let noseWidth = Math.min(...data) * irisScaleFactor;

  return noseWidth;
}

function getNoseDepth(mesh, headPlanes, irisScaleFactor) {

  // NOTE: noseDepth_m and noseDepth_t will not return a value if person
  // is looking straight ahead.

  let noseDepth = calculateNoseDepth(mesh, headPlanes.median);
  if (noseDepth) {
    noseDepth *= irisScaleFactor;
  }
  // NOTE: ... is the spread operator. It unpacks an array.
  //var data = [noseDepth_m, noseDepth_t];
  //data = data.filter(function(i){ return i != null; });
  //let noseDepth = Math.min(...data) * irisScaleFactor;

  //console.log(noseDepth_m * irisScaleFactor, noseDepth_t * irisScaleFactor);
  //console.log(noseDepth);

  return noseDepth;
}

function updateHeadPoseValues(eulerAngles) {
  // Un-pack euler angles
  let rotX = eulerAngles[0]; // Up-down (Down is +ve)
  let rotY = eulerAngles[1]; // Left-right (Left is +ve)
  let rotZ = eulerAngles[2]; // Rotate left-right (Right is +ve)
  // Up-down
  let facing_updown = rotX >= 0.0 ? 'DOWNWARDS' : 'UPWARDS';
  let angle_updown = Math.abs(rotX);
  // Left-right
  let facing_leftright = rotY >= 0.0 ? 'LEFT' : 'RIGHT';
  let angle_leftright = Math.abs(rotY);
  // Rotate_leftright
  let facing_rotate = rotZ >= 0.0 ? 'RIGHT' : 'LEFT';
  let angle_rotate = Math.abs(rotZ);
  // Head pose string
  let headPosition = "Head position: Turned ";
  headPosition += angle_leftright.toFixed(1) + " deg to the " + facing_leftright;
  headPosition += ", " + angle_updown.toFixed(1) + " deg " + facing_updown;
  headPosition += ", and rotated " + angle_rotate.toFixed(1) + " deg to the " + facing_rotate;
  document.getElementById('head-pose').innerHTML = headPosition;
}

function getHeadMeasures(mesh, plotLandmarks = true) {

  // Function to display landmarks on the video frame

  // Get landmark points
  let p_infraorb_L = new THREE.Vector3().fromArray(mesh[LMRK.infraorb_L]);
  let p_infraorb_R = new THREE.Vector3().fromArray(mesh[LMRK.infraorb_R]);
  let p_nose_alar_L = new THREE.Vector3().fromArray(mesh[LMRK.nose_alar_L]);
  let p_nose_alar_R = new THREE.Vector3().fromArray(mesh[LMRK.nose_alar_R]);
  let p_nose_afg_L = new THREE.Vector3().fromArray(mesh[LMRK.nose_alarfacialgroove_L]);
  let p_nose_afg_R = new THREE.Vector3().fromArray(mesh[LMRK.nose_alarfacialgroove_R]);
  let p_nose_tip = new THREE.Vector3().fromArray(mesh[LMRK.nose_tip]);
  let p_sellion = new THREE.Vector3().fromArray(mesh[LMRK.sellion]);
  let p_supramenton = new THREE.Vector3().fromArray(mesh[LMRK.supramenton]);
  let p_tragion_L = new THREE.Vector3().fromArray(mesh[LMRK.tragion_L]);
  let p_tragion_R = new THREE.Vector3().fromArray(mesh[LMRK.tragion_R]);

  // Plot landmarks
  if (plotLandmarks) {
    plotLandmark(p_infraorb_L, BLUE);
    plotLandmark(p_infraorb_R, BLUE);
    plotLandmark(p_nose_alar_L, GREEN);
    plotLandmark(p_nose_alar_R, GREEN);
    plotLandmark(p_nose_afg_L, WHITE);
    plotLandmark(p_nose_afg_R, WHITE);
    plotLandmark(p_nose_tip, WHITE);
    plotLandmark(p_sellion, BLUE);
    plotLandmark(p_supramenton, BLUE);
    plotLandmark(p_tragion_L, RED);
    plotLandmark(p_tragion_R, RED);
  }

  // Get face measurements
  // Face height
  const faceHeight = distanceXY(p_sellion, p_supramenton);
  // Face width (not needed for mask sizing, but maybe useful for conduit sizing)
  const faceWidth = distanceXY(p_tragion_L, p_tragion_R);
  // Nose depth
  const noseDepth = average([distanceXY(p_nose_tip, p_nose_afg_L), distanceXY(p_nose_tip, p_nose_afg_R)]);
  // Nose width
  const noseWidth = distanceXY(p_nose_alar_L, p_nose_alar_R);
  // Landmarks measurements
  let headMeasures = {
    'faceHeight': faceHeight,
    'faceWidth': faceWidth,
    'noseDepth': noseDepth,
    'noseWidth': noseWidth
  };
  return headMeasures;
}

function getEyeAspectRatio(mesh, direction='left') {
  // Returns eye aspect ratio and boolean if eye is open  
  let eyeAspectRatio = null;
  // direction must be 'left' or 'right'
  direction = direction.toLowerCase();
  if (!(direction == 'left' || direction == 'right')) { return eyeAspectRatio; }
  // Ear aspect ratio (EAR) = height / width
  let labelLower = `${direction}EyeLower0`;
  let labelUpper = `${direction}EyeUpper0`;
  let lowerPoints = MESH_ANNOTATIONS[labelLower].map(i => new THREE.Vector3().fromArray(mesh[i]));
  let upperPoints = MESH_ANNOTATIONS[labelUpper].map(i => new THREE.Vector3().fromArray(mesh[i]));
  let lowMiddle = lowerPoints[lowerPoints.length / 2 | 0];
  let uppMiddle = upperPoints[upperPoints.length / 2 | 0];
  let eyeHeight = lowMiddle.distanceTo(uppMiddle);
  let eyeWidth  = lowerPoints[0].distanceTo(lowerPoints[lowerPoints.length-1]);
  eyeAspectRatio = eyeHeight / eyeWidth;
  // Typically EAR = 0.3 if eye open, and EAR < 0.15 if eye is closed
  let isEyeOpen = eyeAspectRatio > 0.15;
  return [eyeAspectRatio, isEyeOpen];
}

function getIrisMeasures(scaledMesh) {
  // Get iris measures
  let irisDiameters = null;
  let has_iris = scaledMesh.length > NUM_KEYPOINTS;
  if (has_iris) {
    // Get coordinates of iris keypoints
    let leftIris = MESH_ANNOTATIONS['leftEyeIris'].map(i => new THREE.Vector3().fromArray(scaledMesh[i]));
    let rightIris = MESH_ANNOTATIONS['rightEyeIris'].map(i => new THREE.Vector3().fromArray(scaledMesh[i]));
    // Plot left and right iris keypoints
    leftIris.map(lmrk => plotLandmark(lmrk, RED, 2));
    rightIris.map(lmrk => plotLandmark(lmrk, RED, 2));
    // Get iris diameter
    // Left iris
    let leftRadius = [];
    for (let i = 1; i < MESH_ANNOTATIONS['leftEyeIris'].length; i++) {
      leftRadius.push(distanceXY(leftIris[i], leftIris[0]));
    }
    let leftIrisDiameter = average(leftRadius) * 2;
    // Right iris
    let rightRadius = [];
    for (let i = 1; i < MESH_ANNOTATIONS['rightEyeIris'].length; i++) {
      rightRadius.push(distanceXY(rightIris[i], rightIris[0]));
    }
    let rightIrisDiameter = average(rightRadius) * 2;
    // Min, max and average iris diameters
    let avgIrisDiameter = average([leftIrisDiameter, rightIrisDiameter]);
    let minIrisDiameter = leftIrisDiameter < rightIrisDiameter ? leftIrisDiameter : rightIrisDiameter;
    let maxIrisDiameter = leftIrisDiameter > rightIrisDiameter ? leftIrisDiameter : rightIrisDiameter;
    // Iris scale factor
    let irisScaleFactor = IRIS_DIAMETER_AVGERAGE / maxIrisDiameter;
    // Store iris diameters
    irisDiameters = {
      'iris_diam_left' : leftIrisDiameter,
      'iris_diam_right': rightIrisDiameter,
      'iris_diam_min'  : minIrisDiameter,
      'iris_diam_max'  : maxIrisDiameter,
      'iris_diam_avg'  : avgIrisDiameter,
      'iris_diam_scale': irisScaleFactor,
      'ear_left'       : getEyeAspectRatio(scaledMesh, 'left')[0],
      'ear_right'      : getEyeAspectRatio(scaledMesh, 'right')[0],
    };
    // Show iris
    plotIris(leftIris[0], leftIrisDiameter, RED);
    plotIris(rightIris[0], rightIrisDiameter, RED);
  }
  return irisDiameters;
}

function updateHeadMeasureValues(headMeasures, tableId, tableRowIndex) {

  function updateTableValues(rowIndex, colIndex, text) {
    let row = document.getElementById(tableId).rows;
    let targetRow = Math.min(Math.max(rowIndex, 0), row.length - 1);
    let col = row[targetRow].cells;
    let targetCol = Math.min(Math.max(colIndex, 0), col.length - 1);
    col[targetCol].innerHTML = text;
  }
  for (const [k, v] of Object.entries({ 'noseWidth': 1, 'noseDepth': 2, 'faceHeight': 3, 'faceWidth': 4 })) {
    if (headMeasures[k] != null) {
      updateTableValues(v, tableRowIndex, headMeasures[k].toFixed(1));
    }
  }
  //updateTableValues(1, tableRowIndex, headMeasures.noseWidth.toFixed(1));
  //updateTableValues(2, tableRowIndex, headMeasures.noseDepth.toFixed(1));
  //updateTableValues(3, tableRowIndex, headMeasures.faceHeight.toFixed(1));
  //updateTableValues(4, tableRowIndex, headMeasures.faceWidth.toFixed(1));
}

function updateMaskSizeRecommend(maskSizes, tableId, tableRowIndex) {

  function updateTableValues(rowIndex, colIndex, text) {
    let row = document.getElementById(tableId).rows;
    let targetRow = Math.min(Math.max(rowIndex, 0), row.length - 1);
    let col = row[targetRow].cells;
    let targetCol = Math.min(Math.max(colIndex, 0), col.length - 1);
    col[targetCol].innerHTML = text;
  }
  updateTableValues(1, tableRowIndex, maskSizes['F20']);
  updateTableValues(2, tableRowIndex, maskSizes['F30']);
  updateTableValues(3, tableRowIndex, maskSizes['F30i']);
  updateTableValues(4, tableRowIndex, maskSizes['N20']);
  updateTableValues(5, tableRowIndex, maskSizes['N30i']);
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

function scatterPlot(predictions) {

  if (renderPointcloud && state.renderPointcloud && scatterGL != null) {
    const pointsData = predictions.map(prediction => {
      let scaledMesh = prediction.scaledMesh;
      return scaledMesh.map(point => ([-point[0], -point[1], -point[2]]));
    });

    let flattenedPointsData = [];
    for (let i = 0; i < pointsData.length; i++) {
      flattenedPointsData = flattenedPointsData.concat(pointsData[i]);
    }
    const dataset = new ScatterGL.Dataset(flattenedPointsData);

    if (!scatterGLHasInitialized) {
      scatterGL.setPointColorer((i) => {
        if (i >= NUM_KEYPOINTS) {
          return RED;
        }
        return BLUE;
      });
      scatterGL.render(dataset);
    } else {
      scatterGL.updateDataset(dataset);
    }
    scatterGLHasInitialized = true;
  }
}

async function run() {

  stats.begin();
  const predictions = await model.estimateFaces(
    video, false /* returnTensors */, false /* flipHorizontal */,
    state.predictIrises);
  ctx.drawImage(
    video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);

  if (predictions.length > 0) {

    // Display mesh and irises
    predictions.forEach(prediction => {

      const mesh = prediction.mesh;
      let scaledMesh = prediction.scaledMesh;

      // Render the face mesh (points or triangulated mesh)
      renderFacemesh(scaledMesh);

      // Get head orientation (could use mesh or scaledMesh)
      let [eulerAngles, headPlanes] = getHeadPose(scaledMesh);
      // Update head pose values in html
      updateHeadPoseValues(eulerAngles);

      // Get iris diameter data
      let irisMeasures = getIrisMeasures(scaledMesh);


      // Head measurements v1 - Raw mesh data from facemesh model
      // --------------------------------------------------------
      let headMeasuresv1 = getHeadMeasures(mesh, false);
      updateHeadMeasureValues(headMeasuresv1, "unfiltered", 1);

      // Write to file
      let angles = {'rotx' : eulerAngles[0], 'roty' : eulerAngles[1], 'rotz' : eulerAngles[2]};
      logMeasurements.appendData([angles, headMeasuresv1, irisMeasures]);

      // Update time averaged
      for (const [key, value] of Object.entries(headMeasuresv1)) {
        movingAverage_headMeasuresv1[key].update(value);
      }
      let filtered_v1 = {
        'noseWidth' : movingAverage_headMeasuresv1.noseWidth.average(),
        'noseDepth' : movingAverage_headMeasuresv1.noseDepth.average(),
        'faceHeight': movingAverage_headMeasuresv1.faceHeight.average(),
        'faceWidth' : movingAverage_headMeasuresv1.faceWidth.average()
      };
      updateHeadMeasureValues(filtered_v1, "filtered", 1);

      // Add mask size recommendation
      let fh1 = movingAverage_headMeasuresv1.faceHeight.average();
      let nw1 = movingAverage_headMeasuresv1.noseWidth.average();
      let nd1 = movingAverage_headMeasuresv1.noseDepth.average();
      let mask_sizes_v1 = {
        'F20' : mask_sizer_F20(fh1),
        'F30' : mask_sizer_F30(nw1, nd1),
        'F30i': mask_sizer_F30i(nw1, nd1),
        'N20' : mask_sizer_N20(nw1),
        'N30i': mask_sizer_N30i(nw1, nd1)
      };
      updateMaskSizeRecommend(mask_sizes_v1, "mask-size-recommend", 1);


      // Head measurements v2 - scaledMesh scaled using iris diameter
      // ------------------------------------------------------------
      // Get face and head landmarks measurements
      let headMeasuresv2 = getHeadMeasures(scaledMesh);
      // Get iris diameter data
      //let irisMeasures = getIrisMeasures(scaledMesh);
      // Scale head measures using iris diameter
      if (irisMeasures) {
        for (const [key, value] of Object.entries(headMeasuresv2)) {
          headMeasuresv2[key] = value * irisMeasures.scale * scaleFactorv2;
        }
      }
      // Update html with head measures and iris measures
      updateHeadMeasureValues(headMeasuresv2, "unfiltered", 2);

      // Update time averaged
      for (const [key, value] of Object.entries(headMeasuresv2)) {
        movingAverage_headMeasuresv2[key].update(value);
      }
      let filtered_v2 = {
        'noseWidth' : movingAverage_headMeasuresv2.noseWidth.average(),
        'noseDepth' : movingAverage_headMeasuresv2.noseDepth.average(),
        'faceHeight': movingAverage_headMeasuresv2.faceHeight.average(),
        'faceWidth' : movingAverage_headMeasuresv2.faceWidth.average()
      }
      updateHeadMeasureValues(filtered_v2, "filtered", 2);

      // Add mask size recommendation
      let fh2 = movingAverage_headMeasuresv2.faceHeight.average();
      let nw2 = movingAverage_headMeasuresv2.noseWidth.average();
      let nd2 = movingAverage_headMeasuresv2.noseDepth.average();
      let mask_sizes_v2 = {
        'F20' : mask_sizer_F20(fh2),
        'F30' : mask_sizer_F30(nw2, nd2),
        'F30i': mask_sizer_F30i(nw2, nd2),
        'N20' : mask_sizer_N20(nw2),
        'N30i': mask_sizer_N30i(nw2, nd2)
      }
      updateMaskSizeRecommend(mask_sizes_v2, "mask-size-recommend", 2);


      // Head measurements v3 - Same as v2, but with projections onto head planes
      // ------------------------------------------------------------------------

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
    });

    // Show the scatter plot
    scatterPlot(predictions);

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

  if (renderPointcloud) {
    document.querySelector('#scatter-gl-container').style =
      `width: ${VIDEO_SIZE[0]}px; height: ${VIDEO_SIZE[1]}px;`;

    scatterGL = new ScatterGL(
      document.querySelector('#scatter-gl-container'),
      { 'rotateOnStart': false, 'selectEnabled': false });
  }
};

main();
