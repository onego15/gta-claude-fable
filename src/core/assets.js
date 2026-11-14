import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;
export const url = (p) => BASE + p;

export const CHAR_MODELS = ['Male_Casual', 'Male_LongSleeve', 'Male_Shirt', 'Male_Suit', 'Female_Alternative', 'Female_Casual', 'Female_Dress', 'Female_TankTop'];
export const CAR_MODELS = ['NormalCar1', 'NormalCar2', 'SUV', 'SportsCar', 'SportsCar2', 'Taxi', 'Cop', 'Cop_SUV'];
export const AUDIO_FILES = { engine: 'audio/engine.ogg', skid: 'audio/skid.ogg', impact: 'audio/impact.ogg', ambience: 'audio/city_ambience.ogg' };

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const jobs = [];
  const out = { chars: {}, cars: {}, anims: {}, audio: {} };
  for (const n of CHAR_MODELS) jobs.push(['chars', n, `models/char_${n}.glb`]);
  for (const n of CAR_MODELS) jobs.push(['cars', n, `models/car_${n}.glb`]);
  jobs.push(['anims', 'male', 'models/anim_male.glb'], ['anims', 'female', 'models/anim_female.glb']);
  let done = 0; const total = jobs.length + Object.keys(AUDIO_FILES).length;
  const tick = () => { done++; onProgress && onProgress(done / total); };
  await Promise.all([
    ...jobs.map(async ([k, n, p]) => { out[k][n] = await loader.loadAsync(url(p)); tick(); }),
    ...Object.entries(AUDIO_FILES).map(async ([k, p]) => {
      try { const r = await fetch(url(p)); out.audio[k] = await r.arrayBuffer(); } catch (e) { console.warn('audio load failed', p, e); }
      tick();
    }),
  ]);
  return out;
}
