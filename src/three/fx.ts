/**
 * Sprite-based particle bursts — hearts while petting, coins on a completed
 * session, Zzz over a sleeping cat. Sprites are used deliberately: they always
 * face the camera, so a burst reads the same from any angle and never clips
 * into the set.
 *
 * A fixed pool is allocated per glyph. Bursts past the pool size recycle the
 * oldest particle rather than allocating during a frame.
 */
import * as THREE from 'three';
import { glyphTexture } from './toon';

export type FxKind = 'heart' | 'star' | 'coin' | 'sleep' | 'sparkle' | 'note' | 'anger' | 'question';

const GLYPH: Record<FxKind, string> = {
  heart: '💗',
  star: '⭐',
  coin: '🪙',
  sleep: '💤',
  sparkle: '✨',
  note: '🎵',
  anger: '💢',
  question: '❓',
};

const POOL = 18;

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
  size: number;
  /** Sine drift so hearts wobble as they rise instead of tracking straight. */
  wobble: number;
  phase: number;
}

export interface BurstOptions {
  count?: number;
  /** Upward bias of the initial velocity. */
  rise?: number;
  spread?: number;
  size?: number;
  life?: number;
}

export interface FxSystem {
  group: THREE.Group;
  burst(kind: FxKind, at: THREE.Vector3, opts?: BurstOptions): void;
  update(dt: number): void;
  clear(): void;
  dispose(): void;
}

export function createFx(reduced = false): FxSystem {
  const group = new THREE.Group();
  group.name = 'fx';
  const pools = new Map<FxKind, Particle[]>();
  const live: Particle[] = [];

  const poolFor = (kind: FxKind): Particle[] => {
    let pool = pools.get(kind);
    if (pool) return pool;
    pool = [];
    const material = new THREE.SpriteMaterial({
      map: glyphTexture(GLYPH[kind]),
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    for (let i = 0; i < POOL; i++) {
      // Each sprite needs its own material clone so opacity can fade per particle.
      const sprite = new THREE.Sprite(material.clone());
      sprite.visible = false;
      sprite.renderOrder = 10;
      group.add(sprite);
      pool.push({
        sprite,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        spin: 0,
        size: 0.2,
        wobble: 0,
        phase: 0,
      });
    }
    material.dispose();
    pools.set(kind, pool);
    return pool;
  };

  const take = (pool: Particle[]): Particle => {
    for (const p of pool) if (p.life <= 0) return p;
    // All busy — steal whichever has the least life left.
    let oldest = pool[0];
    for (const p of pool) if (p.life < oldest.life) oldest = p;
    return oldest;
  };

  const burst: FxSystem['burst'] = (kind, at, opts = {}) => {
    const pool = poolFor(kind);
    const count = Math.max(1, Math.round((opts.count ?? 6) * (reduced ? 0.4 : 1)));
    const rise = opts.rise ?? 0.9;
    const spread = opts.spread ?? 0.5;
    const size = opts.size ?? 0.22;
    const life = opts.life ?? 1.5;

    for (let i = 0; i < count; i++) {
      const p = take(pool);
      if (p.life <= 0) live.push(p);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      p.sprite.position.set(at.x + Math.cos(a) * r * 0.6, at.y + (Math.random() - 0.2) * 0.1, at.z + Math.sin(a) * r * 0.6);
      p.vel.set(Math.cos(a) * spread * 0.5, rise * (0.7 + Math.random() * 0.6), Math.sin(a) * spread * 0.5);
      p.maxLife = life * (0.75 + Math.random() * 0.5);
      p.life = p.maxLife;
      p.spin = (Math.random() - 0.5) * 3;
      p.size = size * (0.8 + Math.random() * 0.5);
      p.wobble = 0.4 + Math.random() * 0.6;
      p.phase = Math.random() * Math.PI * 2;
      p.sprite.visible = true;
      p.sprite.scale.setScalar(0.001);
    }
  };

  const update = (dt: number): void => {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        live.splice(i, 1);
        continue;
      }
      const age = 1 - p.life / p.maxLife;
      p.vel.y -= dt * 0.35; // gentle gravity so the arc peaks and falls back
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.position.x += Math.sin(p.phase + age * 8) * p.wobble * dt * 0.35;
      p.sprite.material.rotation += p.spin * dt;

      // Pop in over the first 18%, then shrink and fade out over the tail.
      const pop = age < 0.18 ? age / 0.18 : 1;
      const fade = age > 0.55 ? 1 - (age - 0.55) / 0.45 : 1;
      p.sprite.scale.setScalar(p.size * (0.6 + pop * 0.4) * (0.55 + fade * 0.45));
      p.sprite.material.opacity = Math.min(1, pop * 1.4) * fade;
    }
  };

  const clear = (): void => {
    for (const p of live) {
      p.life = 0;
      p.sprite.visible = false;
    }
    live.length = 0;
  };

  const dispose = (): void => {
    clear();
    for (const pool of pools.values()) {
      for (const p of pool) {
        p.sprite.material.dispose();
        group.remove(p.sprite);
      }
    }
    pools.clear();
  };

  return { group, burst, update, clear, dispose };
}
