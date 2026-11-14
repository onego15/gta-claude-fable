import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Final grade: vignette + subtle warm/cool split toning + film grain + damage/slowmo desaturation
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.32 }, desat: { value: 0 }, hurt: { value: 0 }, flash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, desat, hurt, flash; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      // split toning: warm highlights, teal shadows
      c.rgb += (vec3(0.035,0.012,-0.02) * smoothstep(0.4,1.0,l)) + (vec3(-0.015,0.008,0.025) * (1.0 - smoothstep(0.0,0.35,l)));
      c.rgb = max(vec3(0.0), (c.rgb - 0.5) * 1.13 + 0.5 - 0.012);
      float l2 = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = mix(vec3(l2), c.rgb, 1.16);
      c.rgb = mix(c.rgb, vec3(l2), desat);
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
      c.rgb *= mix(1.0, v, vignette);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.0,0.35,0.3) + vec3(0.18,0.0,0.0), hurt * (1.0 - v) * 1.4);
      c.rgb += flash;
      c.rgb += (hash(vUv * 900.0 + time) - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};

export class Graphics {
  constructor(container) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.6;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.5, 0.86);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass()); this.composer.addPass(this.grade);
    this.quality = 'high';
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  setQuality(q) {
    this.quality = q;
    const pr = q === 'low' ? 0.75 : q === 'medium' ? 1 : Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.bloom.enabled = q !== 'low';
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  render(dt) {
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }
}
