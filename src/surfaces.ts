import * as THREE from "three";

/** PBR asphalt with world-space aggregate; derivatives fade fine grain at distance. */
export function roadMaterial(map: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({
    map,
    color: 0xb6bdc2,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 vRoadPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvRoadPosition = (modelMatrix * vec4(position, 1.0)).xyz;",
    );
    shader.fragmentShader =
      `varying vec3 vRoadPosition;
float roadHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float roadNoise(vec2 p) {
 vec2 cell=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(roadHash(cell),roadHash(cell+vec2(1,0)),f.x),mix(roadHash(cell+vec2(0,1)),roadHash(cell+vec2(1,1)),f.x),f.y);
}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
vec2 roadXZ=vRoadPosition.xz;
float roadGrain=roadNoise(roadXZ*34.0);
float grainVisibility=1.0-smoothstep(.25,1.4,length(fwidth(roadXZ*34.0)));
float roadWeather=roadNoise(roadXZ*.32);
diffuseColor.rgb *= .93 + .10*roadWeather + (roadGrain-.5)*.18*grainVisibility;
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (roadWeather-.5)*.12, .76, .98);",
    );
  };
  material.customProgramCacheKey = () => "meadow-asphalt-v1";
  return material;
}

export function finishCarMaterials(model: THREE.Object3D) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const rubber = object.name.startsWith("wheel-");
    const finish = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const material = new THREE.MeshPhysicalMaterial({
        name: source.name,
        map: source.map,
        color: source.color,
        normalMap: source.normalMap,
        normalScale: source.normalScale,
        side: source.side,
        transparent: source.transparent,
        opacity: source.opacity,
        vertexColors: source.vertexColors,
        roughness: rubber ? 0.82 : 0.3,
        metalness: rubber ? 0 : 0.08,
        clearcoat: rubber ? 0 : 0.65,
        clearcoatRoughness: 0.24,
        envMapIntensity: rubber ? 0.35 : 1.25,
      });
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(finish)
      : finish(object.material);
  });
}
