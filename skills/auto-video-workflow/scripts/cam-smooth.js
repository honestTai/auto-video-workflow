/*!
 * cam-smooth.js — Smooth Continuous-Canvas Camera Transitions & Focus Choreography for motion-lib
 *
 * Eliminates abrupt PPT-style screen wipes (shatter/halftone/blinds/crt-off) in favor of
 * spatial camera movement inspired by top anime-explainer channels:
 *   - data-in="cam-pan(dir=left|right|up|down,dur=0.48,blur=8)" : infinite-canvas whip-pan
 *   - data-in="cam-push(dur=0.44,scale=1.07,blur=8)"            : gentle depth push-dissolve
 *   - data-in="cam-cut(dur=0.14)"                              : crisp match-on-action crossfade
 *   - data-fx="cam-focus@1.8(x=130,y=15,s=1.08,dur=0.65)"      : within-scene camera pan/zoom focus
 *   - data-fx="cam-breathe@0(to=1.035,dur=7)"                  : subtle continuous Ken Burns drift
 */
(function (g) {
  'use strict';
  var FX = g.FX;
  var gsap = g.gsap;
  if (!FX || !gsap) throw new Error('cam-smooth: load gsap.min.js and fx.js first');

  var num = function (v, d) { return v === undefined || v === null || v === '' || isNaN(+v) ? d : +v; };

  // Inject base continuous-canvas & overlay stacking styles once
  if (typeof document !== 'undefined' && !document.getElementById('avw-cam-smooth-css')) {
    var st = document.createElement('style');
    st.id = 'avw-cam-smooth-css';
    st.textContent = [
      '.cam-canvas-root {',
      '  background-color: #0d1018;',
      '  background-image:',
      '    radial-gradient(rgba(255,255,255,0.065) 1.5px, transparent 1.6px),',
      '    radial-gradient(85% 75% at 50% 24%, rgba(36, 48, 82, 0.42) 0%, rgba(11, 14, 22, 0) 75%);',
      '  background-size: 32px 32px, 100% 100%;',
      '  background-position: 0px 0px, 0px 0px;',
      '}',
      '.scene.canvas-clear { background: transparent !important; }',
      '.scene.overlay { z-index: 900 !important; }',
      '.fx-subs { z-index: 960 !important; }',
      '.fx-chapters { z-index: 950 !important; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // Track cumulative parallax offset for continuous background dot-grid
  var bgPos = { x: 0, y: 0 };

  function registerTrans(name, desc, fn) {
    FX.trans[name] = fn;
    FX.catalog.push({ name: name, cat: '转场', desc: desc });
  }

  /**
   * 1. cam-pan: Spatial camera whip-pan across an infinite continuous blackboard canvas.
   *    dir=left means camera pans RIGHT (old content exits left, new content enters from right).
   *    dir=right means camera pans LEFT (old exits right, new enters from left).
   *    dir=up / dir=down pan vertically.
   */
  registerTrans('cam-pan', '无限画布顺滑摇镜：背景无缝连续，前镜内容沿方向顺势滑出、后镜内容同向滑入并带轻微动态模糊。参数 dir=left|right|up|down、dur、dist、blur', function (tl, t, prev, next, o) {
    var d = num(o.dur, 0.48);
    var dir = o.dir || 'left';
    var dist = num(o.dist, dir === 'up' || dir === 'down' ? 760 : 1280);
    var blur = num(o.blur, 8);
    var dx = dir === 'left' ? -dist : dir === 'right' ? dist : 0;
    var dy = dir === 'up' ? -dist : dir === 'down' ? dist : 0;

    var lead = Math.min(t, d * 0.26);
    var outStart = Math.max(0, t - lead);
    var outDur = d * 0.68;
    var inDur = d * 0.84;
    var blurOn = blur > 0 ? 'blur(' + blur + 'px)' : 'none';

    if (prev) {
      tl.to(prev, {
        x: dx,
        y: dy,
        opacity: 0,
        filter: blurOn,
        duration: outDur,
        ease: 'power3.inOut',
        immediateRender: false
      }, outStart);
      // Clean reset after hidden so backward scrubbing stays crisp
      tl.set(prev, { x: 0, y: 0, opacity: 1, filter: 'none' }, t + outDur + 0.04);
    }

    tl.fromTo(next,
      { x: -dx, y: -dy, opacity: 0, filter: blurOn },
      { x: 0, y: 0, opacity: 1, filter: 'blur(0px)', duration: inDur, ease: 'expo.out', immediateRender: false },
      t
    );
    tl.set(next, { filter: 'none' }, t + inDur + 0.02);

    // Subtle parallax shift on continuous root dot-grid canvas
    var root = next && next.parentElement;
    if (root && root.classList.contains('cam-canvas-root')) {
      var fromX = bgPos.x, fromY = bgPos.y;
      bgPos.x += dx * 0.22;
      bgPos.y += dy * 0.22;
      var toX = bgPos.x, toY = bgPos.y;
      var p = { k: 0 };
      tl.fromTo(p, { k: 0 }, {
        k: 1,
        duration: d,
        ease: 'power3.inOut',
        immediateRender: false,
        onUpdate: function () {
          var cx = fromX + (toX - fromX) * p.k;
          var cy = fromY + (toY - fromY) * p.k;
          root.style.backgroundPosition = cx.toFixed(1) + 'px ' + cy.toFixed(1) + 'px, 0px 0px';
        }
      }, outStart);
    }

    return Math.max(0.05, outDur - lead + 0.04);
  });

  /**
   * 2. cam-push: Gentle depth push-dissolve for chapter shifts or blackboard <-> 3D/PiP transitions.
   */
  registerTrans('cam-push', '柔和纵深推镜过渡：前镜轻推淡出，后镜从略远景深顺滑定焦，无刺眼遮罩。参数 dur、scale、blur', function (tl, t, prev, next, o) {
    var d = num(o.dur, 0.44);
    var outScale = num(o.scale, 1.07);
    var inScale = num(o.from, 0.94);
    var blur = num(o.blur, 8);
    var lead = Math.min(t, d * 0.22);
    var outStart = Math.max(0, t - lead);
    var outDur = d * 0.68;
    var inDur = d * 0.84;

    if (prev) {
      tl.to(prev, {
        scale: outScale,
        opacity: 0,
        filter: blur > 0 ? 'blur(' + blur + 'px)' : 'none',
        duration: outDur,
        ease: 'power2.inOut',
        immediateRender: false
      }, outStart);
      tl.set(prev, { scale: 1, opacity: 1, filter: 'none' }, t + outDur + 0.04);
    }

    tl.fromTo(next,
      { scale: inScale, opacity: 0, filter: blur > 0 ? 'blur(' + Math.round(blur * 0.7) + 'px)' : 'none' },
      { scale: 1, opacity: 1, filter: 'blur(0px)', duration: inDur, ease: 'power3.out', immediateRender: false },
      t
    );
    tl.set(next, { filter: 'none' }, t + inDur + 0.02);

    return Math.max(0.05, outDur - lead + 0.04);
  });

  /**
   * 3. cam-cut: Ultra-crisp 8-frame match-on-action soft dissolve (blackboard <-> full-bleed skit room).
   */
  registerTrans('cam-cut', '干脆动作顺接微溶：8 帧极短柔和过渡，用于黑板讲解与实景剧场互切。参数 dur', function (tl, t, prev, next, o) {
    var d = num(o.dur, 0.14);
    tl.fromTo(next, { opacity: 0 }, { opacity: 1, duration: d, ease: 'power1.out', immediateRender: false }, t);
    return d;
  });

  /**
   * 4. cam-focus: Within-scene smooth camera pan & zoom onto left/right cards or focal points.
   *    Usage: data-fx="cam-focus@1.8(x=130,y=12,s=1.08,dur=0.65) cam-focus@4.2(x=-130,y=12,s=1.08,dur=0.65)"
   */
  FX.register('cam-focus', '镜头', '单镜内虚拟摄像机推拉摇移聚焦（左卡→右卡→回全景），全程丝滑缓动。参数 x、y、s(缩放)、dur、ease', function (c) {
    var d = num(c.o.dur, 0.62);
    var ease = (FX.eases && FX.eases[c.o.ease]) || c.o.ease || 'power3.inOut';
    c.els.forEach(function (el) {
      gsap.set(el, { transformOrigin: '50% 48%' });
      c.tl.to(el, {
        x: num(c.o.x, 0),
        y: num(c.o.y, 0),
        scale: num(c.o.s, 1),
        duration: d,
        ease: ease,
        immediateRender: false
      }, c.t);
    });
  });

  /**
   * 5. cam-breathe: Subtle continuous Ken Burns slow push so no frame ever feels dead-frozen.
   */
  FX.register('cam-breathe', '镜头', '镜头呼吸微推：让单镜在口播期间保持极轻微持续推近。参数 from、to、dur', function (c) {
    var d = num(c.o.dur, c.sceneDur || 5);
    c.els.forEach(function (el) {
      gsap.set(el, { transformOrigin: '50% 45%' });
      c.tl.fromTo(el,
        { scale: num(c.o.from, 1.0) },
        { scale: num(c.o.to, 1.032), duration: d, ease: 'none', immediateRender: false },
        c.t
      );
    });
  });
})(window);
