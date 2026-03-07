// ─── Canvas Setup ───────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─── Mouse Tracking ────────────────────────────────────────
let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// ─── Utility ────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function angleTo(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }
function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Spine ──────────────────────────────────────────────────
const SEGMENT_COUNT = 36;
const SEGMENT_SPACING = 11;

const segments = [];
for (let i = 0; i < SEGMENT_COUNT; i++) {
    segments.push({
        x: canvas.width / 2,
        y: canvas.height / 2 + i * SEGMENT_SPACING,
        angle: -Math.PI / 2,
        width: 0,
    });
}
for (let i = 0; i < SEGMENT_COUNT; i++) {
    const t = i / (SEGMENT_COUNT - 1);
    if (t < 0.08) segments[i].width = lerp(5, 10, t / 0.08);
    else if (t < 0.35) segments[i].width = lerp(10, 14, (t - 0.08) / 0.27);
    else if (t < 0.55) segments[i].width = lerp(14, 10, (t - 0.35) / 0.2);
    else segments[i].width = lerp(10, 1.5, (t - 0.55) / 0.45);
}

// ─── Leg Configuration ─────────────────────────────────────
// 14 pairs! Centipede-like density along segments 2-22
// Legs gradually get smaller toward the rear
const legPairs = [];
const LEG_PAIR_COUNT = 14;
for (let i = 0; i < LEG_PAIR_COUNT; i++) {
    const t = i / (LEG_PAIR_COUNT - 1); // 0 at front, 1 at rear
    const segIdx = Math.round(2 + t * 20); // segments 2 through 22
    const sizeFactor = 1 - t * 0.55; // front legs are bigger
    legPairs.push({
        seg: segIdx,
        len1: Math.round(24 * sizeFactor),
        len2: Math.round(28 * sizeFactor),
        clawSize: Math.round(9 * sizeFactor),
    });
}

// ─── Particles & Drips ─────────────────────────────────────
const particles = [];
const drips = [];
function spawnParticle(x, y, color, sizeBase) {
    particles.push({ x, y, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, life: 1, decay: 0.006 + Math.random() * 0.018, size: (sizeBase || 1.5) + Math.random() * 2, color: color || [100, 255, 80] });
}
function spawnDrip(x, y) {
    drips.push({ x, y, vy: 0.3 + Math.random() * 0.7, life: 1, decay: 0.008 + Math.random() * 0.01, size: 1 + Math.random() * 1.5 });
}
function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.vy *= 0.98; p.life -= p.decay; if (p.life <= 0) particles.splice(i, 1); }
    if (particles.length > 300) particles.splice(0, 50);
    for (let i = drips.length - 1; i >= 0; i--) { const d = drips[i]; d.y += d.vy; d.vy += 0.02; d.life -= d.decay; if (d.life <= 0) drips.splice(i, 1); }
    if (drips.length > 100) drips.splice(0, 20);
}
function drawParticles() {
    for (const p of particles) { ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.life * 0.6})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill(); }
    for (const d of drips) { ctx.fillStyle = `rgba(50,120,30,${d.life * 0.5})`; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.size * 0.6, d.size * 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
}

// ─── Footprints ─────────────────────────────────────────────
const footprints = [];
function addFootprint(x, y, angle, size) { footprints.push({ x, y, angle, life: 1, size: size || 1 }); if (footprints.length > 300) footprints.shift(); }
function drawFootprints() {
    for (let i = footprints.length - 1; i >= 0; i--) {
        const f = footprints[i]; f.life -= 0.003;
        if (f.life <= 0) { footprints.splice(i, 1); continue; }
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.angle);
        ctx.fillStyle = `rgba(25,50,15,${f.life * 0.25})`;
        for (let c = -1; c <= 1; c++) { ctx.beginPath(); ctx.ellipse(3 * f.size, c * 2.5 * f.size, 2.5 * f.size, 1 * f.size, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }
}

// ─── Leg IK ─────────────────────────────────────────────────
// side: 1 = right, -1 = left
function solveLegIK(ox, oy, tx, ty, len1, len2, side, bodyAngle, isFront) {
    let d = dist(ox, oy, tx, ty);
    const maxReach = (len1 + len2) * 0.95;
    if (d > maxReach) {
        const a = angleTo(ox, oy, tx, ty);
        tx = ox + Math.cos(a) * maxReach;
        ty = oy + Math.sin(a) * maxReach;
        d = maxReach;
    }
    if (d < Math.abs(len1 - len2) + 1) d = Math.abs(len1 - len2) + 1;

    const a = angleTo(ox, oy, tx, ty);
    const cosElbow = clamp((len1 * len1 + d * d - len2 * len2) / (2 * len1 * d), -1, 1);
    const elbowOffset = Math.acos(cosElbow);

    // Permanent bend direction prevents inverse-kinematics joint flipping.
    // Front legs bend backward, rear legs bend forward (keeping elbows outward).
    const bendMult = isFront ? 1 : -1;
    const jointAngle = a + elbowOffset * side * bendMult;

    return { jx: ox + Math.cos(jointAngle) * len1, jy: oy + Math.sin(jointAngle) * len1, ex: tx, ey: ty };
}

// ════════════════════════════════════════════════════════════
// ═══ NEIGHBOR-CONSTRAINT GAIT ══════════════════════════════
// ════════════════════════════════════════════════════════════

const STEP_THRESHOLD = 35;
const STEP_FRAMES = 9;
const STEP_LIFT = 7;

const legs = [];
for (let i = 0; i < legPairs.length; i++) {
    const seg = segments[legPairs[i].seg];
    const t = i / (legPairs.length - 1);
    
    // Shift center back so more legs point forward, and widen angle spread
    const sweepAngle = (t - 0.6) * (Math.PI / 1.8);
    
    // Open up the front legs much more
    const reachOffset = (1 - t) * 24; 
    const reach = (legPairs[i].len1 + legPairs[i].len2) * 0.7 + reachOffset;

    for (let s = 0; s < 2; s++) {
        const mul = s === 0 ? 1 : -1;
        const legAngle = seg.angle + (Math.PI / 2 + sweepAngle) * mul;
        legs.push({
            pairIdx: i,
            sideIdx: s,
            sideMul: mul,
            x: seg.x + Math.cos(legAngle) * reach,
            y: seg.y + Math.sin(legAngle) * reach,
            planted: true,
            stepping: false,
            stepT: 0,
            startX: 0, startY: 0,
            goalX: 0, goalY: 0,
            liftHeight: 0,
        });
    }
}

function getNeighborIndices(legIndex) {
    const leg = legs[legIndex];
    const pi = leg.pairIdx, si = leg.sideIdx;
    const n = [];
    n.push(pi * 2 + (1 - si));  // opposite side same pair
    if (pi > 0) n.push((pi - 1) * 2 + si);  // same side prev pair
    if (pi < legPairs.length - 1) n.push((pi + 1) * 2 + si);  // same side next pair
    return n;
}

function canLegStep(legIndex) {
    for (const ni of getNeighborIndices(legIndex)) {
        if (legs[ni].stepping) return false;
    }
    return true;
}

function getIdealFootPos(legIndex) {
    const leg = legs[legIndex];
    const lp = legPairs[leg.pairIdx];
    const seg = segments[lp.seg];
    const a = seg.angle;
    
    // Front legs slightly forward (-), middle sideways (0), rear backward (+)
    const t = leg.pairIdx / (legPairs.length - 1);
    
    // Shift zero-point to t=0.6 so more legs point forward
    const sweepAngle = (t - 0.6) * (Math.PI / 1.8);
    const legAngle = a + (Math.PI / 2 + sweepAngle) * leg.sideMul;

    // Increase reach for front legs so they are less "tight"
    const reachOffset = (1 - t) * 24;
    const reach = (lp.len1 + lp.len2) * 0.7 + reachOffset;
    return {
        x: seg.x + Math.cos(legAngle) * reach + Math.cos(a) * 3,
        y: seg.y + Math.sin(legAngle) * reach + Math.sin(a) * 3,
    };
}

function getStepTarget(legIndex) {
    const leg = legs[legIndex];
    const seg = segments[legPairs[leg.pairIdx].seg];
    const ideal = getIdealFootPos(legIndex);
    // Mild velocity prediction based on segment's own velocity
    const predict = Math.min(STEP_FRAMES * 0.5, 4);
    return {
        x: ideal.x + (seg.vx || 0) * predict,
        y: ideal.y + (seg.vy || 0) * predict,
    };
}

function updateFeet() {
    for (const leg of legs) {
        if (!leg.stepping) continue;
        leg.stepT += 1 / STEP_FRAMES;
        if (leg.stepT >= 1) {
            leg.stepT = 1; leg.stepping = false; leg.planted = true;
            leg.x = leg.goalX; leg.y = leg.goalY; leg.liftHeight = 0;
            const lp = legPairs[leg.pairIdx];
            addFootprint(leg.x, leg.y, segments[lp.seg].angle, lp.clawSize / 10);
        } else {
            const t = leg.stepT;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            leg.x = lerp(leg.startX, leg.goalX, ease);
            leg.y = lerp(leg.startY, leg.goalY, ease);
            leg.liftHeight = Math.sin(t * Math.PI) * STEP_LIFT;
        }
    }

    const urgencies = [];
    for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        if (!leg.planted || leg.stepping) continue;
        const ideal = getIdealFootPos(i);
        const d = dist(leg.x, leg.y, ideal.x, ideal.y);
        if (d > STEP_THRESHOLD) urgencies.push({ index: i, urgency: d });
    }
    urgencies.sort((a, b) => b.urgency - a.urgency);

    for (const u of urgencies) {
        const leg = legs[u.index];
        if (leg.stepping) continue;
        if (canLegStep(u.index)) {
            const target = getStepTarget(u.index);
            leg.startX = leg.x; leg.startY = leg.y;
            leg.goalX = target.x; leg.goalY = target.y;
            leg.stepping = true; leg.planted = false; leg.stepT = 0;
        }
    }
}

// ─── Draw Leg ───────────────────────────────────────────────
function drawLeg(originX, originY, footX, footY, liftHeight, len1, len2, clawSize, sideMul, bodyAngle, isFront) {
    const fvy = footY - liftHeight;
    const ik = solveLegIK(originX, originY, footX, fvy, len1, len2, sideMul, bodyAngle, isFront);

    // Ground shadow when lifted
    if (liftHeight > 0.5) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(liftHeight / STEP_LIFT, 1) * 0.12})`;
        ctx.beginPath(); ctx.ellipse(footX, footY, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    }

    // Shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(originX + 2, originY + 2); ctx.lineTo(ik.jx + 2, ik.jy + 2); ctx.lineTo(ik.ex + 2, ik.ey + 2); ctx.stroke();

    // Bones
    drawBone(originX, originY, ik.jx, ik.jy, 2.5);
    drawBone(ik.jx, ik.jy, ik.ex, ik.ey, 1.8);

    // Shoulder joint
    ctx.fillStyle = 'rgba(190,195,170,0.9)'; ctx.beginPath(); ctx.arc(originX, originY, 3, 0, Math.PI * 2); ctx.fill();
    // Elbow joint
    ctx.fillStyle = 'rgba(200,205,180,0.95)'; ctx.beginPath(); ctx.arc(ik.jx, ik.jy, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(40,45,30,0.4)'; ctx.beginPath(); ctx.arc(ik.jx, ik.jy, 1.5, 0, Math.PI * 2); ctx.fill();

    // Claw
    const footAngle = angleTo(ik.jx, ik.jy, ik.ex, ik.ey);
    drawClaw(ik.ex, ik.ey, footAngle, clawSize);
}

function drawBone(x1, y1, x2, y2, width) {
    const a = angleTo(x1, y1, x2, y2);
    const perp = a + Math.PI / 2;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const bulge = width * 0.25;
    ctx.fillStyle = 'rgba(185,190,165,0.85)';
    ctx.beginPath();
    ctx.moveTo(x1 + Math.cos(perp) * width * 0.5, y1 + Math.sin(perp) * width * 0.5);
    ctx.quadraticCurveTo(mx + Math.cos(perp) * (width * 0.5 + bulge), my + Math.sin(perp) * (width * 0.5 + bulge), x2 + Math.cos(perp) * width * 0.35, y2 + Math.sin(perp) * width * 0.35);
    ctx.lineTo(x2 - Math.cos(perp) * width * 0.35, y2 - Math.sin(perp) * width * 0.35);
    ctx.quadraticCurveTo(mx - Math.cos(perp) * (width * 0.5 + bulge), my - Math.sin(perp) * (width * 0.5 + bulge), x1 - Math.cos(perp) * width * 0.5, y1 - Math.sin(perp) * width * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(210,215,195,0.3)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function drawClaw(x, y, angle, size) {
    if (size < 2) return;
    const toes = [-1.2, -0.4, 0.4, 1.2];
    for (const t of toes) {
        const ca = angle + t * 0.35;
        ctx.strokeStyle = 'rgba(200,205,180,0.8)'; ctx.lineWidth = 1.2;
        const tex = x + Math.cos(ca) * size * 0.55, tey = y + Math.sin(ca) * size * 0.55;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tex, tey); ctx.stroke();
        const cla = ca - 0.12;
        const tipX = tex + Math.cos(cla) * size * 0.4, tipY = tey + Math.sin(cla) * size * 0.4;
        ctx.strokeStyle = 'rgba(240,240,220,0.85)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tex, tey);
        ctx.quadraticCurveTo(tex + Math.cos(ca) * size * 0.2, tey + Math.sin(ca) * size * 0.2, tipX, tipY); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(180,185,160,0.7)'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
}

// ─── Draw Spine & Ribs ─────────────────────────────────────
function drawSpine(time) {
    // Body membrane
    for (let i = 1; i < SEGMENT_COUNT - 1; i++) {
        const s = segments[i], sn = segments[i + 1];
        const perp = s.angle + Math.PI / 2, perpN = sn.angle + Math.PI / 2;
        if (i > 2 && i < SEGMENT_COUNT - 5) {
            ctx.fillStyle = 'rgba(30,45,25,0.18)';
            ctx.beginPath();
            ctx.moveTo(s.x + Math.cos(perp) * s.width, s.y + Math.sin(perp) * s.width);
            ctx.lineTo(sn.x + Math.cos(perpN) * sn.width, sn.y + Math.sin(perpN) * sn.width);
            ctx.lineTo(sn.x - Math.cos(perpN) * sn.width, sn.y - Math.sin(perpN) * sn.width);
            ctx.lineTo(s.x - Math.cos(perp) * s.width, s.y - Math.sin(perp) * s.width);
            ctx.closePath(); ctx.fill();
        }
    }
    ctx.shadowColor = 'rgba(40,160,30,0.1)'; ctx.shadowBlur = 8;
    for (let i = 1; i < SEGMENT_COUNT; i++) {
        const s0 = segments[i - 1], s1 = segments[i];
        const alpha = 1 - (i / SEGMENT_COUNT) * 0.4;
        ctx.strokeStyle = `rgba(170,180,150,${alpha})`; ctx.lineWidth = 3.5 - (i / SEGMENT_COUNT) * 2;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        const size = 4.5 - (i / SEGMENT_COUNT) * 3;
        ctx.fillStyle = `rgba(190,200,170,${alpha})`; ctx.beginPath(); ctx.arc(s1.x, s1.y, size, 0, Math.PI * 2); ctx.fill();
        if (i > 1 && i < SEGMENT_COUNT - 3 && i % 2 === 0) {
            const spikeLen = (1 - i / SEGMENT_COUNT) * 12 + 4; // Longer for hair
            ctx.strokeStyle = `rgba(160,170,140,${alpha * 0.5})`;
            ctx.lineWidth = 0.8;
            const hairBaseA = s1.angle + Math.PI;
            // Wave based on time and segment index
            const wave = Math.sin(time * 5 - i * 0.25) * 0.45;
            // Draw 3 hairs per segment
            for (let h = -1; h <= 1; h++) {
                const hA = hairBaseA + h * 0.2 + wave;
                ctx.beginPath();
                ctx.moveTo(s1.x, s1.y);
                const cpX = s1.x + Math.cos(hA - wave * 0.5) * spikeLen * 0.5;
                const cpY = s1.y + Math.sin(hA - wave * 0.5) * spikeLen * 0.5;
                const ex = s1.x + Math.cos(hA) * spikeLen;
                const ey = s1.y + Math.sin(hA) * spikeLen;
                ctx.quadraticCurveTo(cpX, cpY, ex, ey);
                ctx.stroke();
            }
        }
    }
    // Ribs
    for (let i = 3; i < 22; i++) {
        const seg = segments[i];
        const rp = Math.abs(i - 12) / 10;
        const rl = (1 - rp) * seg.width * 1.8 + 3;
        const perp = seg.angle + Math.PI / 2;
        const alpha = (1 - rp) * 0.4;
        ctx.strokeStyle = `rgba(150,160,130,${alpha})`; ctx.lineWidth = 1.2;
        for (const dir of [1, -1]) {
            const ex = seg.x + Math.cos(perp) * rl * dir;
            const ey = seg.y + Math.sin(perp) * rl * dir;
            const cpx = seg.x + Math.cos(perp) * rl * 0.6 * dir + Math.cos(seg.angle + Math.PI) * 4;
            const cpy = seg.y + Math.sin(perp) * rl * 0.6 * dir + Math.sin(seg.angle + Math.PI) * 4;
            ctx.beginPath(); ctx.moveTo(seg.x, seg.y); ctx.quadraticCurveTo(cpx, cpy, ex, ey); ctx.stroke();
            ctx.fillStyle = `rgba(140,150,120,${alpha * 0.7})`; ctx.beginPath(); ctx.arc(ex, ey, 1, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.shadowBlur = 0;
}

// ─── Draw Skull ─────────────────────────────────────────────
function drawSkull(time) {
    const head = segments[0]; const a = head.angle;
    const hs = dist(head.x, head.y, mouse.x, mouse.y);
    const jaw = Math.min(hs / 200, 1) * 0.15 + Math.sin(time * 2) * 0.03;
    ctx.save(); ctx.translate(head.x, head.y); ctx.rotate(a);
    // Lower jaw
    ctx.save(); ctx.rotate(jaw);
    ctx.fillStyle = 'rgba(175,185,160,0.9)'; ctx.beginPath(); ctx.ellipse(12, 5, 14, 5, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(230,235,210,0.95)';
    for (let t = 0; t < 9; t++) { const tx = 6 + t * 2.2; const tl = 3 + (t === 1 || t === 7 ? 3 : t === 3 || t === 5 ? 2.5 : 1.5); ctx.beginPath(); ctx.moveTo(tx, 5); ctx.lineTo(tx + 0.6, 5 + tl); ctx.lineTo(tx - 0.6, 5 + tl); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // Upper skull
    ctx.save(); ctx.rotate(-jaw * 0.5);
    ctx.fillStyle = 'rgba(195,205,180,0.95)'; ctx.beginPath(); ctx.ellipse(-2, 0, 14, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(190,200,175,0.93)'; ctx.beginPath(); ctx.ellipse(14, 0, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(170,180,155,0.8)'; ctx.beginPath(); ctx.ellipse(2, -8, 8, 3, -0.2, 0, Math.PI); ctx.fill(); ctx.beginPath(); ctx.ellipse(2, 8, 8, 3, 0.2, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,130,100,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(24, 0); ctx.stroke();
    ctx.fillStyle = 'rgba(20,25,15,0.6)'; ctx.beginPath(); ctx.ellipse(-6, -6, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-6, 6, 4, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(5,5,2,0.97)'; ctx.beginPath(); ctx.ellipse(4, -7, 6, 5, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(4, 7, 6, 5, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(80,70,50,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(4, -7, 5, 4, 0.15, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(4, 7, 5, 4, -0.15, 0, Math.PI * 2); ctx.stroke();
    const ep = 0.5 + Math.sin(time * 3.5) * 0.3 + Math.sin(time * 7) * 0.15;
    ctx.shadowColor = 'rgba(80,255,30,0.9)'; ctx.shadowBlur = 18 + Math.sin(time * 4) * 8;
    ctx.fillStyle = `rgba(60,200,20,${ep * 0.5})`; ctx.beginPath(); ctx.arc(5, -7, 4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(5, 7, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(120,255,50,${ep})`; ctx.beginPath(); ctx.arc(5, -7, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(5, 7, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(200,255,150,${ep * 1.2})`; ctx.beginPath(); ctx.ellipse(5.5, -7, 0.8, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(5.5, 7, 0.8, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(15,20,10,0.85)'; ctx.beginPath(); ctx.ellipse(25, -2.5, 2, 1.2, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(25, 2.5, 2, 1.2, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(235,240,215,0.95)';
    for (let t = 0; t < 9; t++) { const tx = 6 + t * 2.2; const tl = 3 + (t === 1 || t === 7 ? 4.5 : t === 3 || t === 5 ? 3.5 : 2); ctx.beginPath(); ctx.moveTo(tx, -5); ctx.lineTo(tx + 0.7, -5 - tl); ctx.lineTo(tx - 0.7, -5 - tl); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = 'rgba(70,80,50,0.5)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(-10, -7); ctx.lineTo(-12, -4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-8, 8); ctx.lineTo(-5, 11); ctx.stroke();
    ctx.strokeStyle = 'rgba(130,140,110,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, -9); ctx.quadraticCurveTo(12, -10, 26, -3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-6, 9); ctx.quadraticCurveTo(12, 10, 26, 3); ctx.stroke();
    ctx.restore();
    if (Math.random() < 0.04) { const dx = head.x + Math.cos(a) * 18 + Math.cos(a + Math.PI / 2) * (Math.random() > 0.5 ? 7 : -7); const dy = head.y + Math.sin(a) * 18 + Math.sin(a + Math.PI / 2) * (Math.random() > 0.5 ? 7 : -7); spawnDrip(dx, dy); }
    ctx.restore();
}

// ─── Draw Tail ──────────────────────────────────────────────
function drawTail(time) {
    const ts = SEGMENT_COUNT - 10;
    for (let i = ts; i < SEGMENT_COUNT - 1; i++) {
        const seg = segments[i]; const p = (i - ts) / (SEGMENT_COUNT - 1 - ts);
        if (i % 2 === 0) { const sl = (1 - p) * 7 + 1; const sa = seg.angle + Math.PI / 2; ctx.strokeStyle = `rgba(170,180,150,${(1 - p) * 0.5})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(seg.x, seg.y); ctx.lineTo(seg.x + Math.cos(sa) * sl, seg.y + Math.sin(sa) * sl); ctx.stroke(); ctx.beginPath(); ctx.moveTo(seg.x, seg.y); ctx.lineTo(seg.x - Math.cos(sa) * sl, seg.y - Math.sin(sa) * sl); ctx.stroke(); }
    }
    const te = segments[SEGMENT_COUNT - 1]; const gs = 2.5 + Math.sin(time * 6) * 1.5;
    ctx.fillStyle = `rgba(60,180,30,${0.15 + Math.sin(time * 4) * 0.1})`; ctx.shadowColor = 'rgba(60,180,30,0.4)'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(te.x, te.y, gs, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    if (Math.random() < 0.12) spawnParticle(te.x, te.y, [60, 180, 40], 1);
}

// ─── Background ─────────────────────────────────────────────
function drawBackground(time) {
    const grad = ctx.createRadialGradient(mouse.x, mouse.y, 30, mouse.x, mouse.y, 600);
    grad.addColorStop(0, 'rgba(18,24,12,0.95)'); grad.addColorStop(0.5, 'rgba(10,14,8,0.98)'); grad.addColorStop(1, 'rgba(4,4,2,1)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(25,30,18,0.35)';
    for (let x = 0; x < canvas.width; x += 50) for (let y = 0; y < canvas.height; y += 50) { ctx.beginPath(); ctx.arc(x + Math.sin(x * 0.008 + time * 0.3) * 3, y + Math.cos(y * 0.008 + time * 0.2) * 3, 0.7, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 8; i++) { const fx = (Math.sin(time * 0.12 + i * 1.8) * 0.5 + 0.5) * canvas.width; const fy = (Math.cos(time * 0.09 + i * 2.3) * 0.5 + 0.5) * canvas.height; const fr = 80 + Math.sin(time * 0.3 + i) * 30; const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr); fg.addColorStop(0, 'rgba(15,30,10,0.07)'); fg.addColorStop(1, 'rgba(15,30,10,0)'); ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill(); }
}

function drawCursor(time) {
    const pulse = 0.4 + Math.sin(time * 3) * 0.3;
    ctx.strokeStyle = `rgba(180,30,30,${pulse})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 14 + Math.sin(time * 2.5) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(200,40,40,${pulse * 0.8})`; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(180,30,30,${pulse * 0.4})`; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(mouse.x - 7, mouse.y); ctx.lineTo(mouse.x - 3, mouse.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.x + 3, mouse.y); ctx.lineTo(mouse.x + 7, mouse.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.x, mouse.y - 7); ctx.lineTo(mouse.x, mouse.y - 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.x, mouse.y + 3); ctx.lineTo(mouse.x, mouse.y + 7); ctx.stroke();
}

function drawShadow() {
    for (let i = 0; i < SEGMENT_COUNT; i++) { const seg = segments[i]; ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.beginPath(); ctx.ellipse(seg.x + 4, seg.y + 4, seg.width + 2, (seg.width + 2) * 0.5, seg.angle, 0, Math.PI * 2); ctx.fill(); }
}

function drawEyeTrail(time) {
    const head = segments[0]; const d = dist(head.x, head.y, mouse.x, mouse.y);
    if (d > 30) { const a = head.angle; const cl = Math.min(d * 0.5, 120); ctx.fillStyle = `rgba(50,180,20,${0.015 + Math.sin(time * 3) * 0.008})`; ctx.beginPath(); const sx = head.x + Math.cos(a) * 10, sy = head.y + Math.sin(a) * 10; ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a - 0.25) * cl, sy + Math.sin(a - 0.25) * cl); ctx.lineTo(sx + Math.cos(a + 0.25) * cl, sy + Math.sin(a + 0.25) * cl); ctx.closePath(); ctx.fill(); }
}

// ─── Update Physics ─────────────────────────────────────────
const MAX_TURN_PER_SEGMENT = 0.12;
let walkCycle = 0;

function update(time) {
    const head = segments[0];
    const oldHeadX = head.x, oldHeadY = head.y;
    const toMouse = angleTo(head.x, head.y, mouse.x, mouse.y);
    const distToMouse = dist(head.x, head.y, mouse.x, mouse.y);

    const stopRadius = 35; // combined radius of skull snout + cursor circle
    let baseSpeed = 0;
    
    if (distToMouse > stopRadius) {
        baseSpeed = Math.min((distToMouse - stopRadius) * 0.03, 4);
        // Smooth head turning toward mouse only if not touched
        head.angle = lerpAngle(head.angle, toMouse, 0.06);
    }

    // Accumulate walk cycle based on distance traveled
    if (baseSpeed > 0.1) {
        walkCycle += baseSpeed * 0.06;
    }

    // Swagger: head sweeps slightly left and right
    const swaggerAngle = head.angle + Math.sin(walkCycle) * 0.25;

    // Lurch: speed pulses smoothly to simulate taking steps
    const lurch = 1 + Math.sin(walkCycle * 2 - Math.PI / 2) * 0.25;
    const finalSpeed = baseSpeed * lurch;

    head.x += Math.cos(swaggerAngle) * finalSpeed;
    head.y += Math.sin(swaggerAngle) * finalSpeed;
    head.vx = head.x - oldHeadX;
    head.vy = head.y - oldHeadY;

    for (let i = 1; i < SEGMENT_COUNT; i++) {
        const prev = segments[i - 1], curr = segments[i];
        const oldX = curr.x, oldY = curr.y;
        const a = angleTo(curr.x, curr.y, prev.x, prev.y);
        const d = dist(curr.x, curr.y, prev.x, prev.y);
        if (d > SEGMENT_SPACING) { curr.x += Math.cos(a) * (d - SEGMENT_SPACING); curr.y += Math.sin(a) * (d - SEGMENT_SPACING); }
        const idealAngle = angleTo(curr.x, curr.y, prev.x, prev.y);
        let angleDiff = idealAngle - prev.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const cd = clamp(angleDiff, -MAX_TURN_PER_SEGMENT, MAX_TURN_PER_SEGMENT);
        curr.angle = lerpAngle(curr.angle, prev.angle + cd + Math.PI, 0.6);
        curr.vx = curr.x - oldX;
        curr.vy = curr.y - oldY;
    }

    const headSpeed = Math.hypot(head.vx, head.vy);
    if (headSpeed > 1.5 && Math.random() < 0.15) spawnParticle(head.x - Math.cos(head.angle) * 22 + (Math.random() - 0.5) * 12, head.y - Math.sin(head.angle) * 22 + (Math.random() - 0.5) * 12, [60, 200, 40], 1);
    if (Math.random() < 0.02) { const ri = Math.floor(Math.random() * SEGMENT_COUNT); const rs = segments[ri]; spawnParticle(rs.x + (Math.random() - 0.5) * 15, rs.y + (Math.random() - 0.5) * 15, [40, 120, 30], 0.8); }

    updateFeet();
    updateParticles();
}

// ─── Render ─────────────────────────────────────────────────
let startTime = performance.now();

function render() {
    const time = (performance.now() - startTime) / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground(time);
    drawFootprints();
    drawShadow();

    // Draw legs with proper body angle for IK elbow direction
    for (const leg of legs) {
        const lp = legPairs[leg.pairIdx];
        const seg = segments[lp.seg];
        // Treat more legs as "front" so their knees bend backwards keeping feet positioned well
        const isFront = leg.pairIdx <= 8; 
        drawLeg(seg.x, seg.y, leg.x, leg.y, leg.liftHeight, lp.len1, lp.len2, lp.clawSize, leg.sideMul, seg.angle, isFront);
    }

    drawSpine(time);
    drawTail(time);
    drawSkull(time);
    drawParticles();

    // -- Dynamic Lighting Overlay --
    ctx.globalCompositeOperation = 'source-over';

    // Create an inverse radial gradient: clear at the cursor, dark at the edges
    const lightRadius = 300 + Math.sin(time * 2) * 15;
    const darknessGrad = ctx.createRadialGradient(mouse.x, mouse.y, 40, mouse.x, mouse.y, lightRadius);
    darknessGrad.addColorStop(0, 'rgba(5, 8, 4, 0)');       // Center is fully transparent (light)
    darknessGrad.addColorStop(0.4, 'rgba(5, 8, 4, 0.2)');   // Extended light presence
    darknessGrad.addColorStop(1, 'rgba(2, 4, 2, 0.97)');    // Edge and beyond is much darker

    ctx.fillStyle = darknessGrad;
    // The gradient automatically extends its last color stop to fill the rest of the rectangle
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // -- Eye Glow Light --
    // Compute world-space positions of the two eyes (local offsets: (5, ±7) rotated by head.angle)
    const headSeg = segments[0];
    const ha = headSeg.angle;
    const perp = ha + Math.PI / 2;
    const eyeForward = 5;
    const eyeSide = 7;
    const eyeBaseX = headSeg.x + Math.cos(ha) * eyeForward;
    const eyeBaseY = headSeg.y + Math.sin(ha) * eyeForward;
    const eyePositions = [
        { x: eyeBaseX - Math.cos(perp) * eyeSide, y: eyeBaseY - Math.sin(perp) * eyeSide },
        { x: eyeBaseX + Math.cos(perp) * eyeSide, y: eyeBaseY + Math.sin(perp) * eyeSide },
    ];
    const eyeGlowRadius = 90;
    ctx.globalCompositeOperation = 'lighter';
    for (const eye of eyePositions) {
        const eyeGrad = ctx.createRadialGradient(eye.x, eye.y, 0, eye.x, eye.y, eyeGlowRadius);
        eyeGrad.addColorStop(0,    'rgba(30, 160, 10, 0.09)');
        eyeGrad.addColorStop(0.35, 'rgba(20, 110, 8,  0.04)');
        eyeGrad.addColorStop(1,    'rgba(0,   0,  0,  0)');
        ctx.fillStyle = eyeGrad;
        ctx.beginPath();
        ctx.arc(eye.x, eye.y, eyeGlowRadius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // drawCursor(time);
}

function gameLoop() {
    const time = (performance.now() - startTime) / 1000;
    update(time);
    render();
    requestAnimationFrame(gameLoop);
}
gameLoop();
