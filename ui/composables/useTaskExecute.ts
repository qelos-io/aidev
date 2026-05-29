const TOKEN_KEY = 'aidev-ui-token';

export function useTaskExecute(onError: (message: string) => void) {
  const execLines = ref<string[]>([]);
  const execRunning = ref(false);
  let execAbort: AbortController | null = null;

  const execText = computed(() => execLines.value.join('\n'));

  function resetExecute() {
    if (execAbort) {
      execAbort.abort();
      execAbort = null;
    }
    execLines.value = [];
    execRunning.value = false;
  }

  function appendExecLine(prefix: string, line: string) {
    execLines.value.push(prefix ? `${prefix} ${line}` : line);
  }

  function handleSseEvent(name: string, data: string) {
    if (name === 'stdout') {
      appendExecLine('', data);
    } else if (name === 'stderr') {
      appendExecLine('[stderr]', data);
    } else if (name === 'exit') {
      try {
        const info = JSON.parse(data) as { code: number | null; signal: string | null };
        appendExecLine(
          '',
          `--- exit code ${info.code ?? 'null'}${info.signal ? `, signal ${info.signal}` : ''} ---`,
        );
      } catch {
        appendExecLine('', `--- exit ${data} ---`);
      }
      execRunning.value = false;
    } else if (name === 'error') {
      appendExecLine('[error]', data || 'unknown error');
      execRunning.value = false;
    }
  }

  async function startExecute(taskId: string) {
    if (execRunning.value) return;
    const token = import.meta.client ? localStorage.getItem(TOKEN_KEY) : null;
    if (!token) {
      onError('Not authenticated — refresh and log in again.');
      return;
    }

    execLines.value = [];
    execRunning.value = true;

    const ctrl = new AbortController();
    execAbort = ctrl;

    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => res.statusText);
        appendExecLine('[error]', `HTTP ${res.status}: ${text || res.statusText}`);
        execRunning.value = false;
        if (execAbort === ctrl) execAbort = null;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      let eventName = 'message';
      let dataLines: string[] = [];

      const flushEvent = () => {
        if (dataLines.length === 0 && eventName === 'message') return;
        handleSseEvent(eventName, dataLines.join('\n'));
        eventName = 'message';
        dataLines = [];
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf('\n');
        while (nl !== -1) {
          const rawLine = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (rawLine === '') {
            flushEvent();
          } else if (rawLine.startsWith(':')) {
            // comment
          } else if (rawLine.startsWith('event:')) {
            eventName = rawLine.slice('event:'.length).trim() || 'message';
          } else if (rawLine.startsWith('data:')) {
            dataLines.push(rawLine.slice('data:'.length).replace(/^ /, ''));
          }
          nl = buf.indexOf('\n');
        }
      }
      flushEvent();
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        appendExecLine('[error]', err instanceof Error ? err.message : String(err));
      }
    } finally {
      execRunning.value = false;
      if (execAbort === ctrl) execAbort = null;
    }
  }

  function stopExecute() {
    if (execAbort) {
      execAbort.abort();
      execAbort = null;
    }
    if (execRunning.value) {
      appendExecLine('', '--- cancelled by user ---');
      execRunning.value = false;
    }
  }

  function clearExecLines() {
    execLines.value = [];
  }

  onBeforeUnmount(() => {
    if (execAbort) {
      execAbort.abort();
      execAbort = null;
    }
  });

  return {
    execLines,
    execRunning,
    execText,
    resetExecute,
    startExecute,
    stopExecute,
    clearExecLines,
  };
}
