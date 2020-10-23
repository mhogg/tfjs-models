import * as THREE from 'three';


export function calculateNoseDepth(lmrks, plane, tol = 1.5) {
    // NOTE: Use either the median or transverse planes for noseDepth
    let ray_origin_z = 1e+6;
    let ray_direction = new THREE.Vector3(0, 0, -1);
    // Get points
    let pnL = lmrks['nose_alarfacialgroove_L'];
    let pnR = lmrks['nose_alarfacialgroove_R'];
    let pnT = lmrks['nose_tip'];
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

export function calculateNoseDepthTransverse(lmrks, headPlanes, tol = 1.5) {
    // Get points
    let pnL = lmrks['nose_alarfacialgroove_L'];
    let pnR = lmrks['nose_alarfacialgroove_R'];
    let pnT = lmrks['nose_tip'];
    let pnLRavg = pnL.clone().lerp(pnR, 0.5);
    // Create frontal facing plane through pnLRavg
    let planeNose = new THREE.Plane().setFromNormalAndCoplanarPoint(headPlanes.frontal.normal, pnLRavg);
    // Project nose tip onto this plane 
    let pnTproj = new THREE.Vector3();
    planeNose.projectPoint(pnT, pnTproj);
    // Create rays from pnT and pnTprojected to transverse plane
    let plane = headPlanes.transverse;
    let ray_origin_z = 1e+6;
    let ray_direction = new THREE.Vector3(0, 0, -1);
    // Ray - nose tip
    let nT_origin = new THREE.Vector3(pnT.x, pnT.y, ray_origin_z);
    let nT_ray = new THREE.Ray(nT_origin, ray_direction);
    // Ray - nose tip projected
    let nTp_origin = new THREE.Vector3(pnTproj.x, pnTproj.y, ray_origin_z);
    let nTp_ray = new THREE.Ray(nTp_origin, ray_direction);
    // Get intersection points
    let noseDepth = null;
    let is_perpendicular = THREE.MathUtils.radToDeg(Math.abs(plane.normal.dot(ray_direction))) < tol;
    if (!is_perpendicular) {
        if ((nT_ray.intersectsPlane(plane)) &&
            (nTp_ray.intersectsPlane(plane))) {
            // nose tip
            let nT_intersect = new THREE.Vector3();
            nT_ray.intersectPlane(plane, nT_intersect);
            // nose_LRavg
            let nTp_intersect = new THREE.Vector3();
            nTp_ray.intersectPlane(plane, nTp_intersect);
            // Get 3D distance between intersection points
            noseDepth = nT_intersect.distanceTo(nTp_intersect);
        }
    }
    return noseDepth;
}

export function calculateNoseDepthTransverse2(lmrks, headPlanes, tol = 1.5) {
    // Get points
    let pnL = lmrks['nose_alarfacialgroove_L'];
    let pnR = lmrks['nose_alarfacialgroove_R'];
    let pnT = lmrks['nose_tip'];
    let pnLRavg = pnL.clone().lerp(pnR, 0.5);
    // Create transverse facing plane through pnLRavg
    let planeNose = new THREE.Plane().setFromNormalAndCoplanarPoint(headPlanes.transverse.normal, pnLRavg);
    // Project nose tip onto this plane 
    let pnTproj = new THREE.Vector3();
    planeNose.projectPoint(pnT, pnTproj);

    // TEST
    //console.log('Test');
    //console.log(pnLRavg);
    //console.log(pnT, pnTproj);
    //console.log(pnT.distanceTo(pnTproj));

    // Create rays from pnT and pnTprojected to transverse plane
    let plane = headPlanes.transverse;
    let ray_origin_z = 1e+6;
    let ray_direction = new THREE.Vector3(0, 0, -1);
    // Ray - nose tip
    let nT_origin = new THREE.Vector3(pnT.x, pnT.y, ray_origin_z);
    let nT_ray = new THREE.Ray(nT_origin, ray_direction);
    // Ray - nose tip projected
    let nTp_origin = new THREE.Vector3(pnTproj.x, pnTproj.y, ray_origin_z);
    let nTp_ray = new THREE.Ray(nTp_origin, ray_direction);
    // Get intersection points
    let noseDepth = null;
    let is_perpendicular = THREE.MathUtils.radToDeg(Math.abs(plane.normal.dot(ray_direction))) < tol;
    if (!is_perpendicular) {
        if ((nT_ray.intersectsPlane(plane)) &&
            (nTp_ray.intersectsPlane(plane))) {
            // nose tip
            let nT_intersect = new THREE.Vector3();
            nT_ray.intersectPlane(plane, nT_intersect);
            // nose_LRavg
            let nTp_intersect = new THREE.Vector3();
            nTp_ray.intersectPlane(plane, nTp_intersect);
            // Get 3D distance between intersection points
            noseDepth = nT_intersect.distanceTo(nTp_intersect);
        }
    }
    return noseDepth;
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
  
