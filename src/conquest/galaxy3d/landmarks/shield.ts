/**
 * The stronghold's shield: a faint dome, bright only at its rim. It is the one
 * effect a landmark is allowed.
 */
import * as THREE from "three";
import type { StrongholdPalette } from "./palettes";

/** Whether a point is inside the dome of these semi-axes over `centre`. */
export function insideShield(
  radii: THREE.Vector3,
  centre: THREE.Vector3,
  point: THREE.Vector3,
): boolean {
  const x = (point.x - centre.x) / radii.x;
  const y = (point.y - centre.y) / radii.y;
  const z = (point.z - centre.z) / radii.z;
  return x * x + y * y + z * z <= 1;
}

/** The upper half of an ellipsoid with semi-axes `radii`, its base at `centre`. */
export function shieldMesh(
  p: StrongholdPalette,
  radii: THREE.Vector3,
  centre: THREE.Vector3,
): THREE.Mesh {
  const g = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(radii.x, radii.y, radii.z);
  const tint = new THREE.Color().setRGB(
    p.shield[0] / 255,
    p.shield[1] / 255,
    p.shield[2] / 255,
    THREE.SRGBColorSpace,
  );
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: tint }, height: { value: radii.y } },
    vertexShader: /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vUp;
uniform float height;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vUp = position.y / height;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 tint;
varying vec3 vN;
varying vec3 vV;
varying float vUp;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  float foot = smoothstep(0.13, 0.0, vUp);
  gl_FragColor = vec4(tint * (rim * 0.4 + foot * 0.1 + 0.015), 1.0);
}`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(centre);
  mesh.renderOrder = 8;
  mesh.raycast = () => {};
  return mesh;
}
