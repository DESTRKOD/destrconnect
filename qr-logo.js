/** Draw QR + center logo (SVG preferred). */
window.drawQrWithLogo = async function drawQrWithLogo(canvas, text, opts) {
  opts = opts || {};
  var size = opts.size || 160;
  var logoUrl = opts.logoUrl || '/images/logoPWA.svg';
  var logoShare = opts.logoShare || 0.22;

  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  function drawLogo() {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var lw = Math.floor(size * logoShare);
        var lx = Math.floor((size - lw) / 2);
        var ly = Math.floor((size - lw) / 2);
        var pad = Math.max(2, Math.floor(lw * 0.1));
        // white quiet zone only (no black box)
        ctx.fillStyle = '#ffffff';
        var r = Math.floor(lw * 0.12);
        var x = lx - pad, y = ly - pad, w = lw + pad * 2, h = lw + pad * 2;
        ctx.beginPath();
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
      img.onerror = function () {
        // try png fallback
        if (logoUrl.indexOf('.svg') !== -1) {
          var img2 = new Image();
          img2.onload = function () {
            var lw = Math.floor(size * logoShare);
            var lx = Math.floor((size - lw) / 2);
            var ly = Math.floor((size - lw) / 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx - 4, ly - 4, lw + 8, lw + 8);
            ctx.drawImage(img2, lx, ly, lw, lw);
            resolve(true);
          };
          img2.onerror = function () { resolve(false); };
          img2.src = '/images/logoPWA.png';
        } else resolve(false);
      };
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
