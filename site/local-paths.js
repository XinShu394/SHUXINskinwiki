// 本地双击版路径重写：
// - 将 data.js 内 OSS 图片链接改成本地相对路径 ../武器/目录/文件
// - 将 covers.js 的封面优先替换为该武器第一条皮肤 A 图，避免依赖 OSS
(function () {
  const OSS_HOST = "skinwiki.oss-cn-guangzhou.aliyuncs.com";

  function toLocalAsset(url) {
    if (!url || typeof url !== "string") return url;

    try {
      const parsed = new URL(url);
      if (parsed.host !== OSS_HOST) return url;

      const parts = parsed.pathname.split("/").filter(Boolean).map((x) => decodeURIComponent(x));
      // 期望格式: /<weapon>/<folder>/<filename>
      if (parts.length < 3) return url;

      const weapon = parts[0];
      const folder = parts[1];
      const filename = parts.slice(2).join("/");
      return `../${weapon}/${folder}/${filename}`;
    } catch {
      return url;
    }
  }

  const skinData = Array.isArray(window.SKIN_DATA) ? window.SKIN_DATA : [];
  for (const row of skinData) {
    row.imageA = toLocalAsset(row.imageA);
    row.imageB = toLocalAsset(row.imageB);
    row.imageC = toLocalAsset(row.imageC);
    row.imageD = toLocalAsset(row.imageD);
  }

  const firstImageByWeapon = {};
  for (const row of skinData) {
    if (!row || !row.weapon || !row.imageA) continue;
    if (!firstImageByWeapon[row.weapon]) firstImageByWeapon[row.weapon] = row.imageA;
  }

  const covers = Array.isArray(window.WEAPON_COVERS) ? window.WEAPON_COVERS : [];
  for (const cover of covers) {
    if (!cover) continue;
    const localSkinImage = firstImageByWeapon[cover.weapon];
    if (localSkinImage) {
      cover.src = localSkinImage;
    } else {
      cover.src = toLocalAsset(cover.src);
    }
  }
})();
