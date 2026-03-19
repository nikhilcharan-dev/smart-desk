import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class ParticlesSwarm {
    constructor(container, count = 25000) {
        this.count = count;
        this.container = container;
        this.speedMult = 1.3;
        this._raf = null;

        // SETUP
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.01);
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 100);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);

        // POST PROCESSING
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.strength = 1.8; bloomPass.radius = 0.4; bloomPass.threshold = 0;
        this.composer.addPass(bloomPass);

        // OBJECTS
        this.dummy = new THREE.Object3D();
        this.color = new THREE.Color();
        this.target = new THREE.Vector3();
        this.pColor = new THREE.Color();

        this.geometry = new THREE.ConeGeometry(0.1, 0.5, 4).rotateX(Math.PI / 2);
        this.material = new THREE.MeshBasicMaterial({ color: 0x00aaff });

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.mesh);

        this.positions = [];
        for (let i = 0; i < this.count; i++) {
            this.positions.push(new THREE.Vector3((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100));
            this.mesh.setColorAt(i, this.color.setHex(0x00ff88));
        }

        this.clock = new THREE.Clock();
        this.animate = this.animate.bind(this);
        this.animate();
    }

    animate() {
        this._raf = requestAnimationFrame(this.animate);
        const time = this.clock.getElapsedTime() * this.speedMult;

        const PARAMS = { "phase": 42.95, "shock": 35, "drift": 1.2, "mass": 2.5, "turb": 1.4 };
        const addControl = (id, _l, _min, _max, val) => PARAMS[id] !== undefined ? PARAMS[id] : val;
        const count = this.count;

        for (let i = 0; i < this.count; i++) {
            let target = this.target;
            let color = this.pColor;

            const phase = addControl("phase", "Explosion Phase", 0, 10, time * 0.3);
            const shockSize = addControl("shock", "Shockwave Radius", 5, 80, 35);
            const nebDrift = addControl("drift", "Nebula Drift", 0, 3, 1.2);
            const starMass = addControl("mass", "Progenitor Mass", 1, 5, 2.5);
            const turbulence = addControl("turb", "Turbulence", 0, 3, 1.4);

            const T = (time * 0.25) % 12.0;

            const coreCount = Math.floor(count * 0.08);
            const shockCount = Math.floor(count * 0.20);
            const ejectaCount = Math.floor(count * 0.45);
            const nebulaCount = Math.floor(count * 0.18);

            let px, py, pz, h, s, l;

            const seed1 = Math.sin(i * 127.1 + 311.7) * 43758.5;
            const rnd1 = seed1 - Math.floor(seed1);
            const seed2 = Math.sin(i * 269.5 + 183.3) * 43758.5;
            const rnd2 = seed2 - Math.floor(seed2);
            const seed3 = Math.sin(i * 419.2 + 74.1) * 43758.5;
            const rnd3 = seed3 - Math.floor(seed3);

            const golden = 2.399963;
            const fibTheta = Math.acos(1 - 2 * (i % 5000) / 5000);
            const fibPhi = golden * (i % 5000);

            if (i < coreCount) {
                const cn = i / coreCount;
                const pulse = Math.max(0, Math.sin(T * 1.5 - cn * 2.0));
                const collapseR = starMass * (4.0 - T * 0.8) * pulse + 0.5;
                const r = Math.max(0.3, collapseR) * (0.7 + cn * 0.6);
                const theta = cn * Math.PI * 2 * 37;
                const phi = Math.acos(1 - 2 * cn);
                const spin = time * (3.0 + cn * 5.0);
                px = r * Math.sin(phi) * Math.cos(theta + spin);
                py = r * Math.cos(phi);
                pz = r * Math.sin(phi) * Math.sin(theta + spin);
                const coreFade = Math.min(T * 0.4, 1.0);
                h = 0.55 + coreFade * 0.1;
                s = 0.6 + coreFade * 0.4;
                l = 0.5 + 0.4 * pulse;

            } else if (i < coreCount + shockCount) {
                const sn = (i - coreCount) / shockCount;
                const delay = rnd1 * 1.5;
                const tLocal = Math.max(0, T - delay);
                const expand = shockSize * Math.min(tLocal * 0.5, 1.0);
                const theta = sn * Math.PI * 2 * 200 + time * 0.5;
                const phi = Math.acos(1 - 2 * sn);
                const wobble = 1.0 + turbulence * 0.1 * Math.sin(sn * 47 + time * 3);
                const r = expand * wobble;
                const equatBias = 1.0 + 0.3 * Math.abs(Math.cos(phi * 3));
                px = r * Math.sin(phi) * Math.cos(theta) * equatBias;
                py = r * Math.cos(phi);
                pz = r * Math.sin(phi) * Math.sin(theta) * equatBias;
                const edgePct = Math.max(0, 1.0 - tLocal * 0.15);
                h = 0.05 + edgePct * 0.55;
                s = 1.0;
                l = 0.35 + edgePct * 0.45;

            } else if (i < coreCount + shockCount + ejectaCount) {
                const en = (i - coreCount - shockCount) / ejectaCount;
                const delay = rnd2 * 2.0;
                const tLocal = Math.max(0, T - delay);
                const speed = (0.5 + rnd1 * 0.8) * starMass * nebDrift;
                const poleBias = Math.pow(Math.abs(Math.cos(fibTheta)), 1.5 - turbulence * 0.3);
                const r = tLocal * speed * (1.0 + poleBias * 1.5);
                const clumpAng = rnd3 * Math.PI * 2;
                const turbOff = turbulence * Math.sin(en * 73 + time * 1.5) * tLocal * 0.4;
                px = r * Math.sin(fibTheta + turbOff) * Math.cos(fibPhi + clumpAng);
                py = r * Math.cos(fibTheta) * (1.5 + poleBias);
                pz = r * Math.sin(fibTheta + turbOff) * Math.sin(fibPhi + clumpAng);
                const elemBias = rnd1;
                h = elemBias < 0.33 ? 0.6 + rnd2 * 0.08
                    : elemBias < 0.66 ? 0.08 + rnd2 * 0.05
                        : 0.97 + rnd2 * 0.03;
                s = 0.85 + rnd3 * 0.15;
                l = 0.2 + rnd2 * 0.35 * Math.min(tLocal * 0.3, 1.0);

            } else if (i < coreCount + shockCount + ejectaCount + nebulaCount) {
                const nn = (i - coreCount - shockCount - ejectaCount) / nebulaCount;
                const delay = rnd1 * 3.0;
                const tLocal = Math.max(0, T - delay);
                const baseR = shockSize * 0.9 + tLocal * nebDrift * 0.3;
                const theta = nn * Math.PI * 2 * 500;
                const phi2 = Math.acos(1 - 2 * nn);
                const clump = 1.0 + turbulence * 0.25 * Math.sin(nn * 89 + time * 0.4)
                    * Math.sin(nn * 37 + time * 0.7);
                const r = baseR * clump * (0.85 + rnd2 * 0.3);
                px = r * Math.sin(phi2) * Math.cos(theta + time * 0.04);
                py = r * Math.cos(phi2) * (1.0 + 0.2 * Math.sin(nn * 13));
                pz = r * Math.sin(phi2) * Math.sin(theta + time * 0.04);
                const zonePick = rnd3;
                h = zonePick < 0.4 ? 0.48 + rnd1 * 0.06
                    : zonePick < 0.7 ? 0.82 + rnd1 * 0.08
                        : 0.07 + rnd1 * 0.05;
                s = 0.9;
                l = 0.15 + rnd2 * 0.25 * Math.min(tLocal * 0.2, 1.0);

            } else {
                const pn = (i - coreCount - shockCount - ejectaCount - nebulaCount) /
                    (count - coreCount - shockCount - ejectaCount - nebulaCount + 1);
                const pulsarR = 1.5 + pn * 4.0;
                const beamAng = pn * Math.PI * 2 * 60 + time * 8.0;
                const beamH = Math.sin(time * 8 + pn * Math.PI) * 6 * pn;
                px = Math.cos(beamAng) * pulsarR * (1 - pn * 0.5);
                py = beamH;
                pz = Math.sin(beamAng) * pulsarR * (1 - pn * 0.5);
                h = 0.58 + pn * 0.05;
                s = 0.7;
                l = 0.5 + 0.4 * (1 - pn) * Math.abs(Math.sin(time * 8 + pn * 6));
            }

            const dist = Math.sqrt(px * px + py * py + pz * pz);
            l = Math.max(0, l - dist * 0.002);

            target.set(px, py, pz);
            color.setHSL(h % 1, s, Math.min(l, 0.95));

            this.positions[i].lerp(this.target, 0.1);
            this.dummy.position.copy(this.positions[i]);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            this.mesh.setColorAt(i, this.pColor);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;

        this.composer.render();
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.composer.setSize(w, h);
    }

    dispose() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this.geometry.dispose();
        this.material.dispose();
        this.scene.remove(this.mesh);
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }
}
