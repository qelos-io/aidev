<template>
  <div class="flow">
    <div class="flow__step">
      <span class="flow__num">1</span>
      <div>
        <strong>Fetch</strong>
        <p>Pull tagged tasks from your provider</p>
      </div>
    </div>
    <div class="flow__arrow" aria-hidden="true">→</div>
    <div class="flow__step">
      <span class="flow__num">2</span>
      <div>
        <strong>Clarify</strong>
        <p>Ask questions when descriptions are unclear</p>
      </div>
    </div>
    <div class="flow__arrow" aria-hidden="true">→</div>
    <div class="flow__step">
      <span class="flow__num">3</span>
      <div>
        <strong>Implement</strong>
        <p>AI agent writes code on a fresh branch</p>
      </div>
    </div>
    <div class="flow__arrow" aria-hidden="true">→</div>
    <div class="flow__step">
      <span class="flow__num">4</span>
      <div>
        <strong>Ship</strong>
        <p>Commit, push, open PR, move to review</p>
      </div>
    </div>
    <div class="flow__arrow" aria-hidden="true">→</div>
    <div class="flow__step">
      <span class="flow__num">5</span>
      <div>
        <strong>Agent review</strong>
        <p>AI reviews the PR diff on tagged tasks</p>
      </div>
    </div>
    <div class="flow__arrow" aria-hidden="true">→</div>
    <div class="flow__step">
      <span class="flow__num">6</span>
      <div>
        <strong>Code review</strong>
        <p>Resolve human PR comments automatically</p>
      </div>
    </div>
    <div class="flow__arrow" aria-hidden="true">→</div>
    <div class="flow__step">
      <span class="flow__num">7</span>
      <div>
        <strong>Merge</strong>
        <p>Squash-merge accepted PRs via gh</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.5rem;
  margin: 2rem 0;
  padding: 1.25rem;
  border-radius: 14px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent), var(--vp-c-bg-soft));
  border: 1px solid var(--vp-c-divider);
}

.flow__step {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  flex: 1 1 140px;
  min-width: 0;
  padding: 0.75rem;
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.flow__num {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 0.8rem;
  font-weight: 700;
  flex-shrink: 0;
}

.flow__step strong {
  display: block;
  margin-bottom: 0.15rem;
}

.flow__step p {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--vp-c-text-2);
}

.flow__arrow {
  display: flex;
  align-items: center;
  color: var(--vp-c-brand-1);
  font-size: 1.25rem;
  font-weight: 700;
  padding: 0 0.15rem;
}

@media (max-width: 768px) {
  .flow__arrow {
    display: none;
  }
}
</style>
