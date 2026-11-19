(() => {
  'use strict';

  const videoRootId = 'youtube-category';
  const imageRootId = 'image-category';

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // RTDB may return a numerically keyed collection as an array.
  function entries(collection, timeField = 'createdAt') {
    return Object.entries(collection || {})
      .filter(([, value]) => isRecord(value))
      .sort(([leftId, left], [rightId, right]) => {
        const leftOrder = Number.isFinite(left.order) ? left.order : Infinity;
        const rightOrder = Number.isFinite(right.order) ? right.order : Infinity;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (Number(left[timeField]) || 0) - (Number(right[timeField]) || 0)
          || leftId.localeCompare(rightId);
      });
  }

  function itemName(item) {
    if (item.type === 'video') return item.title || item.name || item.id || '이름 없는 영상';
    return item.name || item.title || '이름 없는 이미지';
  }

  function resolveDefaults(model) {
    const saved = model.defaults || {};
    const primary = entries(model.categories);
    const selected = primary.find(([id]) => id === saved.primaryId) || primary[0];
    const secondary = entries(selected?.[1].categories);
    const child = secondary.find(([id]) => selected?.[0] === saved.primaryId && id === saved.secondaryId)
      || secondary[0];
    return {
      primaryId: selected?.[0] || '',
      secondaryId: child?.[0] || '',
      mode: saved.mode === 'slide' ? 'slide' : 'grid'
    };
  }

  function legacySection(section, expectedType) {
    const { images, videos, ...properties } = section;
    const sources = expectedType === 'video'
      ? [['video', videos], ['image', images]]
      : [['image', images], ['video', videos]];
    const items = new Map();
    for (const [type, collection] of sources) {
      for (const [legacyKey, item] of entries(collection, 'addedAt')) {
        let key = legacyKey;
        while (items.has(key)) key = type + '-' + key;
        items.set(key, { ...item, type });
      }
    }
    return { ...properties, items: Object.fromEntries(items) };
  }

  function fromLegacy(videoRoot, imageRoot, project = 'video') {
    const sayu = project === 'sayuportfolio';
    const imageFirst = sayu || project === 'artmug-hanxin2' || project === 'image';
    const roots = [
      [videoRootId, videoRoot, 'video', sayu ? 'Live2D 리깅' : '영상 포트폴리오'],
      [imageRootId, imageRoot, 'image', sayu ? '버츄얼 일러스트' : '이미지 포트폴리오']
    ];
    if (imageFirst) roots.reverse();
    const categories = {};
    for (const [id, root, type, name] of roots) {
      if (!isRecord(root)) continue;
      categories[id] = {
        name,
        createdAt: root.createdAt || 0,
        order: Object.keys(categories).length,
        categories: Object.fromEntries(entries(root.categories).map(([key, section]) =>
          [key, legacySection(section, type)]))
      };
      if (root.driveFolderId) categories[id].driveFolderId = root.driveFolderId;
    }
    return { version: 2, categories, defaults: resolveDefaults({ categories }) };
  }

  function read(videoRoot, imageRoot, project) {
    const saved = imageRoot?.portfolioV2;
    if (saved?.version === 2) {
      // Empty objects disappear in RTDB. A saved version still denotes an empty portfolio.
      return { ...saved, categories: saved.categories || {}, defaults: saved.defaults || {} };
    }
    return fromLegacy(videoRoot, imageRoot, project);
  }

  window.ArtmugPortfolio = Object.freeze({ read, fromLegacy, entries, itemName, resolveDefaults });
})();
