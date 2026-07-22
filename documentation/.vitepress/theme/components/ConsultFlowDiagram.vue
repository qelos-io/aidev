<template>
  <div class="consult-flow">
    <p class="consult-flow__intro">
      End-to-end example: a SDK bug on a qelos ticket needs the consumer app's perspective. Only <strong>you</strong> route consults — qelos never delegates to isaac on its own.
    </p>

    <div class="consult-flow__legend" aria-hidden="true">
      <span class="consult-flow__badge consult-flow__badge--primary">Qelos · primary</span>
      <span class="consult-flow__badge consult-flow__badge--human">You · human</span>
      <span class="consult-flow__badge consult-flow__badge--consult">Isaac · consultant</span>
    </div>

    <ol class="consult-flow__steps">
      <li class="consult-flow__step consult-flow__step--human">
        <span class="consult-flow__actor">You</span>
        <div>
          <strong>Ticket created on qelos</strong>
          <p>New card on the shared board, tagged <code>qelos</code> — owned by the SDK project.</p>
        </div>
      </li>

      <li class="consult-flow__connector" aria-hidden="true">↓</li>

      <li class="consult-flow__step consult-flow__step--primary">
        <span class="consult-flow__actor">Qelos</span>
        <div>
          <strong>Qelos picks up the task</strong>
          <p><code>aidev run</code> implements from the qelos repo — branch, commits, normal code flow.</p>
        </div>
      </li>

      <li class="consult-flow__connector" aria-hidden="true">↓</li>

      <li class="consult-flow__step consult-flow__step--primary">
        <span class="consult-flow__actor">Qelos</span>
        <div>
          <strong>Qelos asks a follow-up question</strong>
          <p>Agent needs consumer-side context · posts <code>[aidev-qelos]</code> comment · ticket moves to <em>pending</em>.</p>
        </div>
      </li>

      <li class="consult-flow__connector" aria-hidden="true">↓</li>

      <li class="consult-flow__step consult-flow__step--human">
        <span class="consult-flow__actor">You</span>
        <div>
          <strong>You add <code>isaac-consult</code></strong>
          <p>Manual routing — qelos does not know isaac is on the board. Re-add this label anytime you need another consult.</p>
        </div>
      </li>

      <li class="consult-flow__connector" aria-hidden="true">↓</li>

      <li class="consult-flow__step consult-flow__step--consult">
        <span class="consult-flow__actor">Isaac</span>
        <div>
          <strong>Isaac runs consult</strong>
          <p>Isaac cron (<code>aidev run pending</code>) picks up the ticket from the isaac repo — no git branch, no review status.</p>
        </div>
      </li>

      <li class="consult-flow__connector" aria-hidden="true">↓</li>

      <li class="consult-flow__step consult-flow__step--consult">
        <span class="consult-flow__actor">Isaac</span>
        <div>
          <strong>Isaac posts its perspective</strong>
          <p><code>[aidev-isaac]</code> reply with consumer-app context · removes <code>isaac-consult</code> · adds <code>isaac-consulted</code> · stays <em>pending</em>.</p>
        </div>
      </li>

      <li class="consult-flow__connector" aria-hidden="true">↓</li>

      <li class="consult-flow__step consult-flow__step--primary">
        <span class="consult-flow__actor">Qelos</span>
        <div>
          <strong>Qelos resumes</strong>
          <p>Next run sees a comment without the qelos prefix · continues implementation on the same ticket.</p>
        </div>
      </li>
    </ol>

    <p class="consult-flow__note">
      The <code>-consulted</code> tag is stats/history only. Consult always runs on <em>pending</em> and leaves the ticket <em>pending</em>.
    </p>
  </div>
</template>

<style scoped>
.consult-flow {
  margin: 1.5rem 0 2rem;
  padding: 1.25rem;
  border-radius: 14px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent),
    var(--vp-c-bg-soft)
  );
  border: 1px solid var(--vp-c-divider);
}

.consult-flow__intro {
  margin: 0 0 1rem;
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.consult-flow__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.consult-flow__badge {
  display: inline-block;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.consult-flow__badge--primary {
  background: color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
  color: var(--vp-c-brand-1);
}

.consult-flow__badge--human {
  background: color-mix(in srgb, #f59e0b 22%, transparent);
  color: #b45309;
}

:root.dark .consult-flow__badge--human {
  color: #fbbf24;
}

.consult-flow__badge--consult {
  background: color-mix(in srgb, #22d3ee 20%, transparent);
  color: #0e7490;
}

:root.dark .consult-flow__badge--consult {
  color: #67e8f9;
}

.consult-flow__steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.consult-flow__step {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.consult-flow__step--human {
  border-style: dashed;
  border-color: color-mix(in srgb, #f59e0b 45%, var(--vp-c-divider));
  background: color-mix(in srgb, #f59e0b 6%, var(--vp-c-bg));
}

.consult-flow__step--consult {
  border-color: color-mix(in srgb, #22d3ee 35%, var(--vp-c-divider));
}

.consult-flow__actor {
  flex-shrink: 0;
  min-width: 3.25rem;
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
}

.consult-flow__step--primary .consult-flow__actor {
  color: var(--vp-c-brand-1);
}

.consult-flow__step--human .consult-flow__actor {
  color: #b45309;
}

:root.dark .consult-flow__step--human .consult-flow__actor {
  color: #fbbf24;
}

.consult-flow__step--consult .consult-flow__actor {
  color: #0e7490;
}

:root.dark .consult-flow__step--consult .consult-flow__actor {
  color: #67e8f9;
}

.consult-flow__step strong {
  display: block;
  margin-bottom: 0.15rem;
}

.consult-flow__step p {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.consult-flow__step :deep(code) {
  font-size: 0.78rem;
}

.consult-flow__connector {
  display: flex;
  justify-content: center;
  padding: 0.15rem 0;
  color: var(--vp-c-brand-1);
  font-size: 1.1rem;
  font-weight: 700;
  list-style: none;
}

.consult-flow__note {
  margin: 1rem 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--vp-c-text-3);
}
</style>
