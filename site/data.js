// 各武器数据分布在 site/data/{weapon}.js，按需阅读只需打开对应子文件。
// 本文件在 HTML 中最后加载，将所有子数组合并为 window.SKIN_DATA。
(function () {
  window.SKIN_DATA = [].concat(
    window._SKIN_DATA_ASVAL  || [],
    window._SKIN_DATA_AUG    || [],
    window._SKIN_DATA_K416   || [],
    window._SKIN_DATA_KC17   || [],
    window._SKIN_DATA_M250   || [],
    window._SKIN_DATA_M4A1   || [],
    window._SKIN_DATA_M7     || [],
    window._SKIN_DATA_MP7    || [],
    window._SKIN_DATA_QBZ95  || [],
    window._SKIN_DATA_SCARH  || [],
    window._SKIN_DATA_Vector || [],
    window._SKIN_DATA_腾龙   || []
  );
})();
