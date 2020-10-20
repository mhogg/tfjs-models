import * as THREE from 'three';
import { average, distanceXY} from './utils';
import { mask_sizer_F20, mask_sizer_F30, mask_sizer_F30i, 
         mask_sizer_N20, mask_sizer_N30i } from './mask_sizing';

// Iris scaling
const IRIS_DIAMETER_AVGERAGE = 11.7;

function getCoordinateVectors(M) {
    let m1 = new THREE.Vector3();
    let m2 = new THREE.Vector3();
    let m3 = new THREE.Vector3();
    M.extractBasis(m1, m2, m3);
    return [m1, m2, m3];
}

function getEyeAspectRatio(lmrks, direction='left') {
    // Returns eye aspect ratio and boolean if eye is open
    let eyeAspectRatio = null;
    // direction must be 'left' or 'right'
    direction = direction.toLowerCase();
    if (!(direction == 'left' || direction == 'right')) { return eyeAspectRatio; }
    // Ear aspect ratio (EAR) = height / width
    let lowerPoints = lmrks[`${direction}EyeLower0`];
    let upperPoints = lmrks[`${direction}EyeUpper0`];
    let lowMiddle = lowerPoints[lowerPoints.length / 2 | 0];
    let uppMiddle = upperPoints[upperPoints.length / 2 | 0];
    let eyeHeight = lowMiddle.distanceTo(uppMiddle);
    let eyeWidth  = lowerPoints[0].distanceTo(lowerPoints[lowerPoints.length-1]);
    eyeAspectRatio = eyeHeight / eyeWidth;
    // Typically EAR = 0.3 if eye open, and EAR < 0.15 if eye is closed
    let isEyeOpen = eyeAspectRatio > 0.15;
    return [eyeAspectRatio, isEyeOpen];
  }

export function getHeadPose(lmrks) {
    // Get fixed and moving csyses
    let F = headCsysFixed();       // Fixed csys
    let M = headCsysMoving(lmrks); // Moving csys
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
    let eulerAngles = {};
    for (let i = 0; i < 3; i++) {
      let a = THREE.MathUtils.radToDeg(eulerAnglesRad[i]);
      // NOTE: Correct angles to within -90 to +90 range
      if (a >  90) { a = a - 180; }
      if (a < -90) { a = a + 180; }
      eulerAngles[['rotx','roty','rotz'][i]] = a;
    }
    // Head planes - Used for intersections
    let headPlanes = {
      'frontal'   : createPlaneThroughPoint(lmrks, m3),
      'median'    : createPlaneThroughPoint(lmrks, m1),
      'transverse': createPlaneThroughPoint(lmrks, m2)
    };
    // Return  
    return [eulerAngles, headPlanes];
}

export function getHeadMeasures(lmrks) {

    // Get face measurements
    // Face height
    const faceHeight = distanceXY(lmrks.sellion, lmrks.supramenton);
    // Face width (not needed for mask sizing, but maybe useful for conduit sizing)
    const faceWidth = distanceXY(lmrks.tragion_L, lmrks.tragion_R);
    // Nose depth
    const noseDepth = average([distanceXY(lmrks.nose_tip, lmrks.nose_alarfacialgroove_L), 
      distanceXY(lmrks.nose_tip, lmrks.nose_alarfacialgroove_R)]);
    // Nose width
    const noseWidth = distanceXY(lmrks.nose_alar_L, lmrks.nose_alar_R);
    // Landmarks measurements
    let headMeasures = {
      'faceHeight': faceHeight,
      'faceWidth' : faceWidth,
      'noseDepth' : noseDepth,
      'noseWidth' : noseWidth
    };
    return headMeasures;
}

export function getIrisMeasures(lmrks) {   
    // Get iris diameter
    // Left iris
    let leftRadius = [];
    for (let i = 1; i < lmrks['leftEyeIris'].length; i++) {
        leftRadius.push(distanceXY(lmrks['leftEyeIris'][i], lmrks['leftEyeIris'][0]));
    }
    let leftIrisDiameter = average(leftRadius) * 2;
    // Right iris
    let rightRadius = [];
    for (let i = 1; i < lmrks['rightEyeIris'].length; i++) {
        rightRadius.push(distanceXY(lmrks['rightEyeIris'][i], lmrks['rightEyeIris'][0]));
    }
    let rightIrisDiameter = average(rightRadius) * 2;
    // Min, max and average iris diameters
    let avgIrisDiameter = average([leftIrisDiameter, rightIrisDiameter]);
    let minIrisDiameter = leftIrisDiameter < rightIrisDiameter ? leftIrisDiameter : rightIrisDiameter;
    let maxIrisDiameter = leftIrisDiameter > rightIrisDiameter ? leftIrisDiameter : rightIrisDiameter;
    // Iris scale factor
    let irisScaleFactor = IRIS_DIAMETER_AVGERAGE / maxIrisDiameter;
    // Store iris measures
    let irisMeasures = {
        'iris_diam_left' : leftIrisDiameter,
        'iris_diam_right': rightIrisDiameter,
        'iris_diam_min'  : minIrisDiameter,
        'iris_diam_max'  : maxIrisDiameter,
        'iris_diam_avg'  : avgIrisDiameter,
        'iris_diam_scale': irisScaleFactor,
        'ear_left'       : getEyeAspectRatio(lmrks,'left')[0],
        'ear_right'      : getEyeAspectRatio(lmrks,'right')[0],
    };
    return irisMeasures;
}

function headCsysFromPoints(ptL, ptR, piL, piR) {
    // Returns head csys based on the Frankfort horizontal plane
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

function headCsysFixed() {
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

function headCsysMoving(lmrks) {
    // Head coordinate system based on the updated mesh coordinates
    let csysPoints = [lmrks.tragion_L,  lmrks.tragion_R, 
                      lmrks.infraorb_L, lmrks.infraorb_R];
    // Basis matrix
    return headCsysFromPoints(...csysPoints);
}

function createPlaneThroughPoint(lmrks, normal) {
    // Creates a plane from normal and point on plane
    let p = lmrks.tragion_L.clone().lerp(lmrks.tragion_R, 0.5);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
}

export function getLandmarkCoordinates(mesh, LANDMARKS, MESH_ANNOTATIONS, has_iris) {
    // Gets current 3D coordinates of all landmarks
    let lmrks = {};
    // Face
    for (const [key, value] of Object.entries(LANDMARKS)) {
        lmrks[key] = new THREE.Vector3().fromArray(mesh[value]);
    }
    // Eye and iris, both left and right
    if (has_iris) { 
        ['left', 'right'].forEach(direction => {
            ['EyeIris', 'EyeLower0', 'EyeUpper0'].forEach(lm => {
                let name = `${direction}${lm}`;
                lmrks[name] = [];
                for (let i=0; i < MESH_ANNOTATIONS[name].length; i++) {
                    let index = MESH_ANNOTATIONS[name][i];
                    lmrks[name].push(new THREE.Vector3().fromArray(mesh[index]));
                }
            });
        });
    }
    return lmrks;
}

export function getMaskSizes(headMeasures) {
    let mask_sizes = {
        'F20' : mask_sizer_F20(headMeasures.faceHeight),
        'F30' : mask_sizer_F30(headMeasures.noseWidth, headMeasures.noseDepth),
        'F30i': mask_sizer_F30i(headMeasures.noseWidth, headMeasures.noseDepth),
        'N20' : mask_sizer_N20(headMeasures.noseWidth),
        'N30i': mask_sizer_N30i(headMeasures.noseWidth, headMeasures.noseDepth)
    };   
    return mask_sizes 
}

export function updateHeadMeasureValues(headMeasures, tableId, tableRowIndex) {

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
}

export function updateHeadPoseValues(eulerAngles) {
    // Un-pack euler angles
    let rotX = eulerAngles.rotx; // Up-down (Down is +ve)
    let rotY = eulerAngles.roty; // Left-right (Left is +ve)
    let rotZ = eulerAngles.rotz; // Rotate left-right (Right is +ve)
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

export function updateMaskSizeRecommend(maskSizes, tableId, tableRowIndex) {

    function updateTableValues(rowIndex, colIndex, text) {
      let row = document.getElementById(tableId).rows;
      let targetRow = Math.min(Math.max(rowIndex, 0), row.length - 1);
      let col = row[targetRow].cells;
      let targetCol = Math.min(Math.max(colIndex, 0), col.length - 1);
      col[targetCol].innerHTML = text;
    }
    for (const [k, v] of Object.entries({'F20':1,'F30':2,'F30i':3,'N20':4,'N30i':5})) {
        if (maskSizes[k] != null) {
            updateTableValues(v, tableRowIndex, maskSizes[k]);
        }
    }
  }