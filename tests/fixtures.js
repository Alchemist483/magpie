(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 240; canvas.height = 160;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 240, 160);
  gradient.addColorStop(0, "#e98369"); gradient.addColorStop(1, "#315c79");
  context.fillStyle = gradient; context.fillRect(0, 0, 240, 160);
  document.getElementById("webp").src = canvas.toDataURL("image/webp");
  document.getElementById("data").src = canvas.toDataURL("image/png");
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  document.getElementById("blob").src = URL.createObjectURL(blob);
})();
