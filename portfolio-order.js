function orderedPortfolioEntries(value, timestampField) {
  return Object.entries(value || {}).sort(([keyA, a], [keyB, b]) => {
    const orderA = Number.isFinite(a.order) ? a.order : Infinity;
    const orderB = Number.isFinite(b.order) ? b.order : Infinity;
    return (orderA === orderB ? 0 : orderA - orderB)
      || (Number(a[timestampField]) || 0) - (Number(b[timestampField]) || 0)
      || keyA.localeCompare(keyB);
  });
}

function addOrderHandle(item, key, target = item) {
  item.dataset.sortKey = key;
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'order-handle';
  handle.textContent = '⠿ 순서';
  handle.title = '드래그하여 순서 변경 · 방향키로 이동';
  handle.setAttribute('aria-label', '드래그 또는 방향키로 순서 변경');
  target.prepend(handle);
}

function enablePortfolioOrdering(container, databasePath, horizontal = false) {
  const version = connectionVersion;
  const status = document.getElementById('portfolioOrderStatus');
  let saving = false;
  let drag = null;
  let frame = null;
  const items = () => Array.from(container.children).filter(item => item.dataset.sortKey);
  const keys = () => items().map(item => item.dataset.sortKey);
  const announce = message => { status.textContent = message; };
  function restore(order) {
    const currentItems = items();
    const anchor = currentItems[currentItems.length - 1]?.nextSibling || null;
    const byKey = new Map(currentItems.map(item => [item.dataset.sortKey, item]));
    order.forEach(key => { if (byKey.has(key)) container.insertBefore(byKey.get(key), anchor); });
  }
  async function save(previous) {
    const next = keys();
    if (next.join('|') === previous.join('|')) return;
    if (version !== connectionVersion || !fbState.connected) { restore(previous); return; }
    saving = true;
    container.classList.add('order-saving');
    announce('순서를 저장하는 중입니다...');
    try {
      // 한 번의 PATCH로 형제 항목의 order만 갱신하여 미디어 정보를 보존합니다.
      await fbPatch(databasePath, Object.fromEntries(next.map((key, index) => [key + '/order', index])));
      if (version !== connectionVersion) return;
      const collection = databasePath.split('/').reduce((node, key) => node?.[key], latestData);
      next.forEach((key, index) => { if (collection?.[key]) collection[key].order = index; });
      announce('순서를 저장했습니다. 메인페이지에도 반영됩니다.');
    } catch (_) {
      restore(previous);
      if (version === connectionVersion) announce('순서를 저장하지 못했습니다. 이전 순서로 되돌렸습니다. 다시 시도해주세요.');
    } finally {
      saving = false;
      container.classList.remove('order-saving');
    }
  }
  function moveAtPointer() {
    if (!drag || !drag.moved) return;
    const others = items().filter(item => item !== drag.item);
    const target = others.find(item => {
      const rect = item.getBoundingClientRect();
      return (horizontal ? drag.x < rect.left + rect.width / 2 : drag.y < rect.top + rect.height / 2);
    });
    if (target && drag.item.nextSibling !== target) container.insertBefore(drag.item, target);
    else if (!target && others.length && others[others.length - 1].nextSibling !== drag.item) container.insertBefore(drag.item, others[others.length - 1].nextSibling);
    // DOM 이동 후 포인터 캡처를 다시 설정합니다.
    try { drag.handle.setPointerCapture(drag.pointerId); } catch (_) {}
  }
  function autoScroll() {
    if (!drag) return;
    if (!container.isConnected || version !== connectionVersion) { finish(true); return; }
    if (drag.moved) {
      if (horizontal) {
        const rect = container.getBoundingClientRect();
        if (drag.x < rect.left + 40) container.scrollLeft -= 9;
        else if (drag.x > rect.right - 40) container.scrollLeft += 9;
      } else {
        const main = container.closest('.main-content');
        const scrollHost = main && main.scrollHeight > main.clientHeight ? main : window;
        if (drag.y < 70) scrollHost.scrollBy(0, -9);
        else if (drag.y > window.innerHeight - 70) scrollHost.scrollBy(0, 9);
      }
      moveAtPointer();
    }
    frame = requestAnimationFrame(autoScroll);
  }
  function finish(cancelled) {
    if (!drag) return;
    const active = drag;
    drag = null;
    cancelAnimationFrame(frame);
    active.item.classList.remove('order-dragging');
    active.handle.setAttribute('aria-pressed', 'false');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onEscape);
    window.removeEventListener('blur', onCancel);
    if (cancelled) restore(active.previous);
    else if (active.moved) void save(active.previous);
  }
  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 6) drag.moved = true;
  }
  function onUp(event) { if (drag?.pointerId === event.pointerId) finish(false); }
  function onCancel() { finish(true); }
  function onEscape(event) { if (event.key === 'Escape') finish(true); }
  container.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.order-handle');
    const item = handle?.closest('[data-sort-key]');
    if (!handle || item?.parentElement !== container || saving || drag || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    drag = {item, handle, pointerId:event.pointerId, previous:keys(), x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, moved:false};
    item.classList.add('order-dragging');
    handle.setAttribute('aria-pressed', 'true');
    // 포인터를 잡아 영상 iframe 위와 터치 환경에서도 드래그를 유지합니다.
    handle.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', onMove, {passive:false});
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('blur', onCancel);
    frame = requestAnimationFrame(autoScroll);
  });
  container.addEventListener('keydown', event => {
    const handle = event.target.closest('.order-handle');
    const item = handle?.closest('[data-sort-key]');
    if (!handle || item?.parentElement !== container || saving || drag) return;
    const delta = (horizontal ? {ArrowLeft:-1,ArrowRight:1} : {ArrowUp:-1,ArrowDown:1})[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const list = items();
    const index = list.indexOf(item);
    const neighbor = list[index + delta];
    if (!neighbor) return;
    const previous = keys();
    container.insertBefore(item, delta < 0 ? neighbor : neighbor.nextSibling);
    handle.focus({preventScroll:true});
    void save(previous);
  });
}
