<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    orientation = 'horizontal' as 'horizontal' | 'vertical',
    position = 0.5,
    ratio = $bindable(position),
    class: className = '',
    style = '',
    start,
    end,
  }: {
    orientation?: 'horizontal' | 'vertical'
    position?: number
    ratio?: number
    class?: string
    style?: string
    start?: Snippet
    end?: Snippet
  } = $props()

  let dragging = false
  let containerEl: HTMLElement

  const isH = $derived(orientation === 'horizontal')

  function getMinMax(): [number, number] {
    const cs = getComputedStyle(containerEl)
    const minPct = parseFloat(cs.getPropertyValue('--divider-min-position') || '0')
    const maxPct = parseFloat(cs.getPropertyValue('--divider-max-position') || '100')
    return [minPct / 100, maxPct / 100]
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    const rect = containerEl.getBoundingClientRect()
    const raw = isH
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height
    const [min, max] = getMinMax()
    ratio = Math.max(min, Math.min(max, raw))
  }

  function onPointerUp() {
    dragging = false
  }
</script>

<div
  bind:this={containerEl}
  class={['split-pane', isH ? 'horizontal' : 'vertical', className].filter(Boolean).join(' ')}
  {style}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <div class="split-start" style={isH ? `width: ${ratio * 100}%` : `height: ${ratio * 100}%`}>
    {@render start?.()}
  </div>
  <div
    class="split-divider"
    role="separator"
    aria-orientation={orientation}
    onpointerdown={onPointerDown}
  ></div>
  <div class="split-end">
    {@render end?.()}
  </div>
</div>

<style>
  .split-pane {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .horizontal { flex-direction: row; }
  .vertical { flex-direction: column; }

  .split-start {
    flex: none;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }
  .horizontal .split-start { height: 100%; }
  .vertical .split-start { width: 100%; }

  .split-end {
    flex: 1;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  /* Slot content should fill the pane */
  .split-start :global(> *),
  .split-end :global(> *) {
    height: 100%;
    width: 100%;
  }

  .split-divider {
    flex: none;
    position: relative;
    z-index: 1;
    touch-action: none;
  }

  .horizontal .split-divider {
    width: var(--divider-draggable-area, 13px);
    margin-left: calc(var(--divider-draggable-area, 13px) / -2);
    margin-right: calc(var(--divider-draggable-area, 13px) / -2);
    height: 100%;
    cursor: col-resize;
  }
  .vertical .split-divider {
    width: 100%;
    height: var(--divider-draggable-area, 13px);
    margin-top: calc(var(--divider-draggable-area, 13px) / -2);
    margin-bottom: calc(var(--divider-draggable-area, 13px) / -2);
    cursor: row-resize;
  }

  /* Thin visual line centered within the draggable area */
  .split-divider::after {
    content: '';
    position: absolute;
    background: var(--quiet-neutral-stroke-softer, #e0e0e2);
    transition: background 0.15s;
  }
  .horizontal .split-divider::after {
    top: 0; bottom: 0;
    left: calc(50% - var(--divider-width, 1px) / 2);
    width: var(--divider-width, 1px);
  }
  .vertical .split-divider::after {
    left: 0; right: 0;
    top: calc(50% - var(--divider-width, 1px) / 2);
    height: var(--divider-width, 1px);
  }

  .split-divider:hover::after {
    background: var(--quiet-primary-fill-soft, #d9dafe);
  }
</style>
