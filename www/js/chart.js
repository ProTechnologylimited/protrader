/* Lightweight canvas charts: candlesticks and area/line. */
(function () {
  const PT = window.PT, u = PT.u;

  PT.chart = {
    /* getSeries() -> { type: 'candles'|'line', data: [...] } */
    mount(canvas, getSeries, opts = {}) {
      const ctx = canvas.getContext('2d');
      let w = 0, h = 0, mouse = null, raf = 0;
      const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

      function resize() {
        const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        w = r.width; h = r.height;
        canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
      }

      function draw() {
        if (!w || !h) return;
        const s = getSeries();
        ctx.clearRect(0, 0, w, h);
        if (!s || !s.data || s.data.length < 2) return;
        const up = css('--up'), down = css('--down'), accent = css('--accent'), line = css('--line'), muted = css('--muted'), text = css('--text');
        const padR = w < 480 ? 54 : 68, padB = 20, padT = 10, padL = 6;
        const pw = w - padL - padR, ph = h - padT - padB;
        const max = opts.maxBars || 90;
        const data = s.data.slice(-max), n = data.length;
        let lo = Infinity, hi = -Infinity;
        data.forEach((d) => { const l = s.type === 'candles' ? d.l : d, hh = s.type === 'candles' ? d.h : d; if (l < lo) lo = l; if (hh > hi) hi = hh; });
        const pad = (hi - lo || hi * 0.01) * 0.12; lo -= pad; hi += pad;
        const X = (i) => padL + (i + 0.5) * (pw / n), Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ph;

        ctx.font = '11px Manrope, system-ui, sans-serif'; ctx.textBaseline = 'middle';
        // grid + price axis
        for (let i = 0; i <= 4; i++) {
          const v = lo + ((hi - lo) * i) / 4, y = Y(v);
          ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(w - padR, y + 0.5); ctx.stroke();
          ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText(u.price(v), w - padR + 6, y);
        }
        const last = s.type === 'candles' ? data[n - 1].c : data[n - 1];
        const first = s.type === 'candles' ? data[0].o : data[0];
        const col = last >= first ? up : down;

        if (s.type === 'candles') {
          const bw = Math.max(1.5, (pw / n) * 0.62);
          data.forEach((d, i) => {
            const c = d.c >= d.o ? up : down, x = X(i);
            ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, Y(d.h)); ctx.lineTo(x, Y(d.l)); ctx.stroke();
            const y1 = Y(Math.max(d.o, d.c)), y2 = Y(Math.min(d.o, d.c));
            ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
          });
        } else {
          const g = ctx.createLinearGradient(0, padT, 0, padT + ph);
          g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
          ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
          ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
          ctx.lineTo(X(n - 1), padT + ph); ctx.lineTo(X(0), padT + ph); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        }

        // last price tag
        const ly = Y(last);
        ctx.setLineDash([3, 4]); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(padL, ly + 0.5); ctx.lineTo(w - padR, ly + 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.fillRect(w - padR + 2, ly - 9, padR - 2, 18);
        ctx.fillStyle = col === up ? css('--on-up') || '#000' : css('--on-down') || '#fff';
        ctx.textAlign = 'left'; ctx.fillText(u.price(last), w - padR + 6, ly);

        // crosshair
        if (mouse && mouse.x > padL && mouse.x < w - padR) {
          const i = u.clamp(Math.floor(((mouse.x - padL) / pw) * n), 0, n - 1), d = data[i];
          ctx.strokeStyle = muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(i) + 0.5, padT); ctx.lineTo(X(i) + 0.5, padT + ph); ctx.stroke(); ctx.setLineDash([]);
          const label = s.type === 'candles'
            ? `O ${u.price(d.o)}  H ${u.price(d.h)}  L ${u.price(d.l)}  C ${u.price(d.c)}`
            : u.price(d);
          ctx.fillStyle = text; ctx.textAlign = 'left'; ctx.fillText(label, padL + 6, padT + 8);
        }
      }

      function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
      const ro = new ResizeObserver(resize); ro.observe(canvas);
      const move = (e) => { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; mouse = { x: p.clientX - r.left, y: p.clientY - r.top }; schedule(); };
      const leave = () => { mouse = null; schedule(); };
      canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseleave', leave);
      canvas.addEventListener('touchstart', move, { passive: true }); canvas.addEventListener('touchmove', move, { passive: true }); canvas.addEventListener('touchend', leave);
      const offTheme = PT.bus.on('theme', schedule);
      resize();
      return { redraw: schedule, destroy() { ro.disconnect(); offTheme(); cancelAnimationFrame(raf); } };
    },
  };
})();
