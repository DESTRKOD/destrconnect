/** Draw QR + center logo (logoPWA.png). Uses QRCode lib if loaded. */
window.drawQrWithLogo = async function drawQrWithLogo(canvas, text, opts) {
  opts = opts || {};
  var size = opts.size || 160;
  var logoUrl = opts.logoUrl || '/images/logoPWA.png';
  var logoShare = opts.logoShare || 0.22; // logo size vs QR

  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  function drawLogo() {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var lw = Math.floor(size * logoShare);
        var lx = Math.floor((size - lw) / 2);
        var ly = Math.floor((size - lw) / 2);
        var pad = Math.floor(lw * 0.12);
        // white pad so QR stays scannable
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        var r = Math.floor(lw * 0.15);
        var x = lx - pad, y = ly - pad, w = lw + pad * 2, h = lw + pad * 2;
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.drawImage(img, lx, ly, lw, lw);
        resolve(true);
      };
      img.onerror = function () { resolve(false); };
      img.src = logoUrl;
    });
  }

  if (window.QRCode && QRCode.toCanvas) {
    await new Promise(function (resolve, reject) {
      QRCode.toCanvas(canvas, text, {
        width: size,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#0f172a', light: '#ffffff' }
      }, function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
    await drawLogo();
    return true;
  }

  // Fallback: external QR image + logo (may taint canvas if CORS blocks — then show img only)
  return new Promise(function (resolve) {
    var q = new Image();
    q.crossOrigin = 'anonymous';
    q.onload = async function () {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(q, 0, 0, size, size);
      await drawLogo();
      resolve(true);
    };
    q.onerror = function () { resolve(false); };
    q.src = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
      '&margin=8&ecc=H&data=' + encodeURIComponent(text);
  });
};
