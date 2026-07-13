<script setup lang="ts">
// Hero illustration. The six nodes are the Polkadot logo: elongated ovals
// (~1.72:1, like the mark) pinwheeled around the centre — top/bottom flat, the
// rest at ±60° — so the network arrangement *is* the logo. No centre hub: nodes
// connect peer-to-peer in a ring (decentralized). Each oval is a person (Lucide
// `user`) or a bot (Lucide `bot`); encrypted messages (padlocks) travel the
// edges via CSS offset-path. Static under prefers-reduced-motion.
type Node = { x: number; y: number; rot: number; bot: boolean };

// Ring of radius 66 about (120, 95); oval long-axis tangent to the ring.
const nodes: Node[] = [
  { x: 120, y: 29, rot: 0, bot: true },     // top
  { x: 177.2, y: 62, rot: 60, bot: false }, // upper-right
  { x: 177.2, y: 128, rot: 120, bot: true },// lower-right
  { x: 120, y: 161, rot: 0, bot: false },   // bottom
  { x: 62.8, y: 128, rot: 60, bot: true },  // lower-left
  { x: 62.8, y: 62, rot: 120, bot: false }, // upper-left
];
const RX = 20;
const RY = 12;

const edges: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
];

const flows = [
  { e: 0, dur: 2.8, delay: 0.0, rev: false },
  { e: 1, dur: 3.0, delay: 0.9, rev: true },
  { e: 2, dur: 2.6, delay: 1.6, rev: false },
  { e: 3, dur: 3.2, delay: 0.4, rev: true },
  { e: 4, dur: 2.9, delay: 2.1, rev: false },
  { e: 5, dur: 2.7, delay: 1.2, rev: true },
];

const edgePath = (e: number) => {
  const [a, b] = edges[e];
  return `path('M ${nodes[a].x} ${nodes[a].y} L ${nodes[b].x} ${nodes[b].y}')`;
};
// Centre a 24×24 Lucide glyph on a node, upright (the oval rotates, the icon doesn't).
const glyphTransform = (n: Node) => `translate(${n.x - 8} ${n.y - 8}) scale(0.667)`;
</script>

<template>
  <div class="pca-net">
    <svg viewBox="0 0 240 190" xmlns="http://www.w3.org/2000/svg" role="img"
         aria-label="People and bots exchanging encrypted messages peer-to-peer, arranged as the Polkadot logo">
      <!-- peer links (behind the ovals) -->
      <line
        v-for="(edge, i) in edges" :key="'e' + i" class="edge"
        :x1="nodes[edge[0]].x" :y1="nodes[edge[0]].y"
        :x2="nodes[edge[1]].x" :y2="nodes[edge[1]].y"
      />

      <!-- encrypted messages travelling peer-to-peer -->
      <g
        v-for="(f, i) in flows" :key="'m' + i" class="msg" :class="{ rev: f.rev }"
        :style="{ offsetPath: edgePath(f.e), animationDuration: f.dur + 's', animationDelay: f.delay + 's' }"
      >
        <circle class="msg-chip" r="6.5" />
        <g class="lock" transform="translate(-4.4 -4.8) scale(0.38)">
          <rect class="lock-stroke" x="3" y="11" width="18" height="11" rx="2" />
          <path class="lock-stroke" d="M7 11V7a5 5 0 0 1 10 0v4" />
        </g>
      </g>

      <!-- people & bots — the Polkadot logo's ovals -->
      <g v-for="(n, i) in nodes" :key="'n' + i">
        <ellipse
          class="node" :cx="n.x" :cy="n.y" :rx="RX" :ry="RY"
          :transform="`rotate(${n.rot} ${n.x} ${n.y})`"
        />
        <g class="glyph" :transform="glyphTransform(n)">
          <template v-if="n.bot">
            <path d="M12 8V4H8" />
            <rect x="4" y="8" width="16" height="12" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </template>
          <template v-else>
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </template>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.pca-net {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(460px, 64vw);
  aspect-ratio: 240 / 190;
  color: var(--fg-primary);
}
.pca-net svg { width: 100%; height: 100%; overflow: visible; }

/* peer links */
.edge { stroke: currentColor; stroke-opacity: 0.16; stroke-width: 1; }

/* the logo ovals, made of people & bots — solid mark, knocked-out glyph */
.node { fill: currentColor; }
.glyph {
  fill: none;
  stroke: var(--bg-surface-main);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* encrypted messages */
.msg { offset-rotate: 0deg; animation: pca-travel linear infinite; }
.msg.rev { animation-direction: reverse; }
.msg-chip { fill: var(--bg-surface-main); stroke: currentColor; stroke-opacity: 0.2; stroke-width: 1; }
.lock-stroke { fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }

@keyframes pca-travel {
  0%   { offset-distance: 0%;   opacity: 0; }
  14%  { opacity: 1; }
  86%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .msg { animation: none; offset-distance: 50%; opacity: 1; }
}
</style>
