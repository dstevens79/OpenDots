import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from './api';
import type { Dot, Memory, State, WorkspaceState } from '../shared/types';
import { ConnectionsSection } from './ConnectionsSection';
import { localMicrophoneUnavailableReason } from './microphone';
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme';
export type Dialog =
  | { type: 'space' }
  | { type: 'dot'; dot?: Dot; spaceId: string }
  | { type: 'settings' }
  | { type: 'memory'; memory?: Memory }
  | { type: 'schedule'; threadId: string };
export function WorkspaceDialog({
  dialog,
  state,
  workspace,
  onClose,
  mutate,
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const [name, setName] = useState(
    dialog.type === 'dot' ? (dialog.dot?.name ?? '') : '',
  );
  const [text, setText] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.instructions ?? '')
      : dialog.type === 'memory'
        ? (dialog.memory?.text ?? '')
        : '',
  );
  const [research, setResearch] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.researchAllowed ?? true)
      : state.settings.researchAllowed,
  );
  const [memory, setMemory] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.memoryAllowed ?? true)
      : state.settings.memoryAllowed,
  );
  const [spaceIds, setSpaceIds] = useState(
    dialog.type === 'dot' ? (dialog.dot?.spaceIds ?? [dialog.spaceId]) : [],
  );
  const [defaultSpace, setDefaultSpace] = useState(
    dialog.type === 'dot' ? (dialog.dot?.spaceId ?? dialog.spaceId) : '',
  );
  const [interval, setInterval] = useState('86400');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState(themePreference);
  const [mainTab, setMainTab] = useState<
    'models' | 'connections' | 'harnesses' | 'voice' | 'general'
  >('models');
  const [connectionTab, setConnectionTab] = useState<
    'omniroute' | 'local' | 'custom'
  >('omniroute');
  const [provider, setProvider] = useState({
    kind: 'omniroute',
    baseUrl: '',
    model: '',
    apiKey: '',
    hasApiKey: false,
    voiceModel: '',
    voiceKey: '',
    hasVoiceKey: false,
    voiceName: 'marin',
    voiceBaseUrl: '',
    openCodeUrl: '',
    openCodePassword: '',
    hasOpenCodePassword: false,
    housekeepingKind: 'omniroute',
    housekeepingBaseUrl: '',
    housekeepingModel: '',
    housekeepingApiKey: '',
    hasHousekeepingApiKey: false,
    residentConnectionId: '',
    housekeepingConnectionId: '',
    connections: [] as {
      id: string;
      name: string;
      kind: 'omniroute' | 'openai' | 'grok' | 'gemini' | 'hermes' | 'custom';
      baseUrl: string;
      model: string;
      apiKey: string;
      hasApiKey: boolean;
    }[],
  });
  const [connectionEditorId, setConnectionEditorId] = useState('');
  const [modelChoices, setModelChoices] = useState<string[]>([]);
  const [housekeepingModelChoices, setHousekeepingModelChoices] = useState<
    string[]
  >([]);
  const [voiceModelChoices, setVoiceModelChoices] = useState<string[]>([]);
  const [harnesses, setHarnesses] = useState<{
    hermes: {
      installed: boolean;
      running: boolean;
      url: string;
      model: string;
      job: { state: string; message: string } | null;
    };
    opencode: {
      installed: boolean;
      running: boolean;
      url: string;
      job: { state: string; message: string } | null;
    };
    gemini: {
      installed: boolean;
      running: boolean;
      job: { state: string; message: string } | null;
    };
    codex: {
      installed: boolean;
      running: boolean;
      job: { state: string; message: string } | null;
    };
    grok: {
      installed: boolean;
      running: boolean;
      job: { state: string; message: string } | null;
    };
  } | null>(null);
  const [harnessStatusError, setHarnessStatusError] = useState('');
  const [whisperModel, setWhisperModel] = useState(
    () =>
      localStorage.getItem('opendots-whisper-model') ||
      'Xenova/whisper-tiny.en',
  );
  const [providerNotice, setProviderNotice] = useState('');
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [whisperRecording, setWhisperRecording] = useState(false);
  const [whisperProcessing, setWhisperProcessing] = useState(false);
  const [whisperTranscript, setWhisperTranscript] = useState('');
  const whisperRecorder = useRef<MediaRecorder | undefined>(undefined);
  const whisperStream = useRef<MediaStream | undefined>(undefined);
  const harnessRequestPending = useRef(false);
  const refreshHarnessStatus = useCallback(() => {
    if (harnessRequestPending.current) return;
    harnessRequestPending.current = true;
    void api<typeof harnesses>('/local-harnesses')
      .then((status) => {
        setHarnesses(status);
        setHarnessStatusError('');
      })
      .catch((reason: unknown) =>
        setHarnessStatusError(
          reason instanceof Error
            ? reason.message
            : 'Host status is unavailable; retrying.',
        ),
      )
      .finally(() => {
        harnessRequestPending.current = false;
      });
  }, []);
  const harnessRefreshNeeded =
    !harnesses ||
    Object.values(harnesses).some((item) =>
      ['installing', 'authenticating'].includes(item.job?.state ?? ''),
    );
  useEffect(() => {
    if (dialog.type !== 'settings') return;
    void api<typeof provider>('/provider-settings')
      .then((value: typeof provider) => {
        setProvider((current) => ({
          ...current,
          ...value,
          apiKey: '',
          voiceKey: '',
          connections: (value.connections ?? []).map((connection) => ({
            ...connection,
            apiKey: '',
          })),
        }));
        setConnectionEditorId(value.connections?.[0]?.id ?? '');
        setConnectionTab(
          value.kind === 'custom'
            ? 'custom'
            : value.kind === 'hermes'
              ? 'local'
              : 'omniroute',
        );
      })
      .catch(() =>
        setProviderNotice('Could not load saved provider settings.'),
      );
  }, [dialog.type]);
  useEffect(() => {
    if (dialog.type !== 'settings') return;
    refreshHarnessStatus();
    const timer = window.setInterval(() => {
      if (harnessRefreshNeeded) refreshHarnessStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [
    dialog.type,
    harnessRefreshNeeded,
    refreshHarnessStatus,
    harnesses?.hermes.job?.state,
    harnesses?.opencode.job?.state,
    harnesses?.gemini.job?.state,
    harnesses?.codex.job?.state,
    harnesses?.grok.job?.state,
  ]);
  const harnessLabel: Record<
    'hermes' | 'opencode' | 'gemini' | 'codex' | 'grok',
    string
  > = {
    hermes: 'Hermes',
    opencode: 'OpenCode',
    gemini: 'Gemini CLI',
    codex: 'Codex CLI',
    grok: 'Grok Build',
  };
  const installHarness = async (
    harness: 'hermes' | 'opencode' | 'gemini' | 'codex' | 'grok',
  ) => {
    setProviderNotice(`Starting ${harnessLabel[harness]} installation…`);
    try {
      await api('/local-harnesses/install', 'POST', { harness });
      setHarnesses(await api<typeof harnesses>('/local-harnesses'));
      if (harness === 'opencode') {
        const saved = await api<typeof provider>('/provider-settings');
        setProvider((current) => ({
          ...current,
          ...saved,
          apiKey: '',
          voiceKey: '',
        }));
      }
      setProviderNotice(
        'Installation started. This can take several minutes; this page will update while it runs.',
      );
    } catch (error) {
      setProviderNotice(
        error instanceof Error
          ? error.message
          : 'Could not start installation.',
      );
    }
  };
  const testHarness = async (
    harness: 'hermes' | 'opencode' | 'gemini' | 'codex' | 'grok',
  ) => {
    setProviderNotice(`Testing ${harnessLabel[harness]}…`);
    try {
      const result = await api<{ detail?: string; error?: string }>(
        '/local-harnesses/test',
        'POST',
        { harness },
      );
      setProviderNotice(result.detail || result.error || 'Test completed.');
    } catch (error) {
      setProviderNotice(
        error instanceof Error ? error.message : 'Harness test failed.',
      );
    }
  };
  const signInHarness = async (harness: 'codex' | 'grok') => {
    setProviderNotice(`Starting ${harnessLabel[harness]} sign-in…`);
    try {
      await api('/local-harnesses/login', 'POST', { harness });
      setHarnesses(await api<typeof harnesses>('/local-harnesses'));
      setProviderNotice(
        'Device sign-in started. Follow the URL and code shown in this harness panel.',
      );
    } catch (error) {
      setProviderNotice(
        error instanceof Error ? error.message : 'Could not start sign-in.',
      );
    }
  };
  const startHarness = async (harness: 'hermes' | 'opencode') => {
    try {
      await api('/local-harnesses/start', 'POST', { harness });
      setHarnesses(await api<typeof harnesses>('/local-harnesses'));
      setProviderNotice(
        `${harness === 'hermes' ? 'Hermes' : 'OpenCode'} start requested.`,
      );
    } catch (error) {
      setProviderNotice(
        error instanceof Error ? error.message : 'Could not start harness.',
      );
    }
  };
  const selectedConnection = provider.connections.find(
    (connection) => connection.id === connectionEditorId,
  );
  const updateConnection = (
    id: string,
    patch: Partial<(typeof provider.connections)[number]>,
  ) =>
    setProvider((current) => ({
      ...current,
      connections: current.connections.map((connection) =>
        connection.id === id ? { ...connection, ...patch } : connection,
      ),
    }));
  const addConnection = () => {
    const kind =
      connectionTab === 'local'
        ? 'hermes'
        : connectionTab === 'custom'
          ? 'custom'
          : 'omniroute';
    const id = crypto.randomUUID();
    const connection = {
      id,
      name:
        kind === 'omniroute'
          ? 'OmniRoute'
          : kind === 'hermes'
            ? 'Hermes API'
            : 'Custom endpoint',
      kind,
      baseUrl:
        kind === 'omniroute'
          ? provider.baseUrl || ''
          : kind === 'hermes'
            ? 'http://localhost:8642/v1'
            : '',
      model: '',
      apiKey: '',
      hasApiKey: false,
    } as const;
    setProvider((current) => ({
      ...current,
      connections: [...current.connections, { ...connection }],
    }));
    setConnectionEditorId(id);
  };
  const removeConnection = (id: string) => {
    setProvider((current) => {
      const connections = current.connections.filter(
        (connection) => connection.id !== id,
      );
      const replacement = connections[0]?.id ?? '';
      return {
        ...current,
        connections,
        residentConnectionId:
          current.residentConnectionId === id
            ? replacement
            : current.residentConnectionId,
        housekeepingConnectionId:
          current.housekeepingConnectionId === id
            ? replacement
            : current.housekeepingConnectionId,
      };
    });
    setConnectionEditorId((current) =>
      current === id
        ? (provider.connections.find((item) => item.id !== id)?.id ?? '')
        : current,
    );
  };
  const container = useRef<HTMLElement>(null);
  useEffect(
    () => () => {
      whisperRecorder.current?.stop();
      whisperStream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  const toggleWhisperTest = async () => {
    if (whisperRecording) {
      whisperRecorder.current?.stop();
      whisperStream.current?.getTracks().forEach((track) => track.stop());
      whisperRecorder.current = undefined;
      whisperStream.current = undefined;
      setWhisperRecording(false);
      return;
    }
    const microphoneError = localMicrophoneUnavailableReason();
    if (microphoneError) {
      setProviderNotice(microphoneError);
      return;
    }
    try {
      setWhisperTranscript('');
      setProviderNotice('Requesting microphone access…');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      whisperStream.current = stream;
      whisperRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () =>
        setProviderNotice('Microphone recording failed.');
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setWhisperProcessing(true);
        setProviderNotice('Transcribing locally on this device…');
        void import('./local-transcription')
          .then(({ transcribeAudio }) =>
            transcribeAudio(
              new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
              setProviderNotice,
            ),
          )
          .then((text) => {
            setWhisperTranscript(text);
            setProviderNotice(
              text
                ? 'Whisper test complete.'
                : 'No speech was recognized. Try speaking closer to the microphone.',
            );
          })
          .catch((reason: unknown) =>
            setProviderNotice(
              reason instanceof Error
                ? reason.message
                : 'Local transcription failed.',
            ),
          )
          .finally(() => {
            setWhisperProcessing(false);
            setWhisperRecording(false);
          });
      };
      recorder.start();
      setWhisperRecording(true);
      setProviderNotice(
        'Recording. Say a short sentence, then select Stop and transcribe.',
      );
    } catch (reason) {
      setProviderNotice(
        reason instanceof Error
          ? reason.message
          : 'Microphone access was denied.',
      );
    }
  };
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    container.current
      ?.querySelector<HTMLElement>('input,textarea,select')
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = [
          ...(container.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,textarea,select,a[href]',
          ) ?? []),
        ];
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  const title =
    dialog.type === 'space'
      ? 'A space for something.'
      : dialog.type === 'dot'
        ? dialog.dot
          ? 'Make this Dot yours.'
          : 'Meet your next specialist.'
        : dialog.type === 'settings'
          ? 'Your workspace, your rules.'
          : dialog.type === 'memory'
            ? 'Something to remember.'
            : 'Let your Dot keep time.';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={container}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">ACTUALLY OPEN DOTS</span>
        <h2 id="dialog-title">{title}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            let path = '',
              method = 'POST',
              body: unknown;
            if (dialog.type === 'space') {
              path = '/spaces';
              body = { name, description: text };
            }
            if (dialog.type === 'dot') {
              path = dialog.dot ? `/dots/${dialog.dot.id}` : '/dots';
              method = dialog.dot ? 'PUT' : 'POST';
              body = {
                spaceId: defaultSpace,
                spaceIds,
                name,
                instructions: text,
                researchAllowed: research,
                memoryAllowed: memory,
              };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              body = { researchAllowed: research, memoryAllowed: memory };
            }
            if (dialog.type === 'memory') {
              path = dialog.memory
                ? `/memories/${dialog.memory.id}`
                : '/memories';
              method = dialog.memory ? 'PUT' : 'POST';
              body = { text };
            }
            if (dialog.type === 'schedule') {
              path = '/tasks';
              body = {
                prompt: text,
                threadId: dialog.threadId,
                intervalSeconds: Number(interval),
              };
            }
            const saved = await mutate(path, method, body);
            if (saved && dialog.type === 'settings') {
              const settingsSaved = await mutate(
                '/provider-settings',
                'PATCH',
                {
                  kind: provider.kind,
                  baseUrl: provider.baseUrl,
                  model: provider.model,
                  ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
                  voiceModel: provider.voiceModel,
                  voiceName: provider.voiceName,
                  voiceBaseUrl: provider.voiceBaseUrl,
                  ...(provider.voiceKey ? { voiceKey: provider.voiceKey } : {}),
                  openCodeUrl: provider.openCodeUrl,
                  ...(provider.openCodePassword
                    ? { openCodePassword: provider.openCodePassword }
                    : {}),
                  housekeepingKind: provider.housekeepingKind,
                  housekeepingBaseUrl: provider.housekeepingBaseUrl,
                  housekeepingModel: provider.housekeepingModel,
                  ...(provider.housekeepingApiKey
                    ? { housekeepingApiKey: provider.housekeepingApiKey }
                    : {}),
                  residentConnectionId: provider.residentConnectionId,
                  housekeepingConnectionId: provider.housekeepingConnectionId,
                  connections: provider.connections.map(
                    ({ apiKey, ...connection }) => ({
                      ...connection,
                      ...(apiKey ? { apiKey } : {}),
                    }),
                  ),
                },
              );
              if (settingsSaved) {
                localStorage.setItem('opendots-whisper-model', whisperModel);
                onClose();
              }
            } else if (saved) onClose();
            else if (!saved)
              setError('Could not save. Review the workspace error and retry.');
            setBusy(false);
          }}
        >
          {(dialog.type === 'space' || dialog.type === 'dot') && (
            <>
              <label className="field-label" htmlFor="entity-name">
                Name
              </label>
              <input
                id="entity-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </>
          )}
          {dialog.type !== 'settings' && (
            <>
              <label className="field-label" htmlFor="entity-text">
                {dialog.type === 'dot'
                  ? 'Role instructions'
                  : dialog.type === 'space'
                    ? 'What belongs here?'
                    : dialog.type === 'memory'
                      ? 'Preference or context'
                      : 'Task to revisit'}
              </label>
              <textarea
                id="entity-text"
                rows={4}
                maxLength={dialog.type === 'schedule' ? 4000 : 2000}
                required={dialog.type !== 'space'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  dialog.type === 'dot'
                    ? 'You are a thoughtful research partner. Compare evidence and be clear about uncertainty.'
                    : ''
                }
              />
            </>
          )}
          {dialog.type === 'dot' && (
            <fieldset className="space-access-fields">
              <legend>Space access</legend>
              <p className="muted">
                Choose where this Dot can read and edit pages.
              </p>
              {workspace.spaces.map((space) => (
                <label className="permission-row" key={space.id}>
                  <input
                    type="checkbox"
                    checked={spaceIds.includes(space.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...spaceIds, space.id]
                        : spaceIds.filter((id) => id !== space.id);
                      setSpaceIds(next);
                      if (!next.includes(defaultSpace))
                        setDefaultSpace(next[0] ?? '');
                    }}
                  />
                  <span>{space.name}</span>
                </label>
              ))}
              <label className="field-label" htmlFor="default-space">
                Default destination for saved pages
              </label>
              <select
                id="default-space"
                value={defaultSpace}
                required
                onChange={(event) => setDefaultSpace(event.target.value)}
              >
                <option value="" disabled>
                  Choose a Space
                </option>
                {workspace.spaces
                  .filter((space) => spaceIds.includes(space.id))
                  .map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
              </select>
            </fieldset>
          )}
          {dialog.type === 'dot' && (
            <>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />
                <span>
                  <strong>Public-page research</strong>
                  <small>
                    Allow the server-side read-only browser tool. Global
                    settings always take precedence.
                  </small>
                </span>
              </label>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={memory}
                  onChange={(e) => setMemory(e.target.checked)}
                />
                <span>
                  <strong>Use saved memories</strong>
                  <small>
                    Include your preferences in new turns. Changing permission
                    stops active work.
                  </small>
                </span>
              </label>
            </>
          )}
          {dialog.type === 'dot' && dialog.dot && (
            <ConnectionsSection dotId={dialog.dot.id} />
          )}
          {dialog.type === 'schedule' && (
            <>
              <label className="field-label" htmlFor="schedule-interval">
                Repeat after each successful run
              </label>
              <select
                id="schedule-interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
              >
                <option value="60">Every minute (testing)</option>
                <option value="3600">Every hour</option>
                <option value="86400">Every day</option>
                <option value="604800">Every week</option>
              </select>
              <p className="muted">
                Runs on the server in this same conversation, even with the tab
                closed. Failed or interrupted runs wait for manual retry. Review
                completed work before retrying an interrupted run.
              </p>
            </>
          )}
          {dialog.type === 'settings' && (
            <>
              <nav className="settings-tabs" aria-label="Settings sections">
                {(
                  [
                    'models',
                    'connections',
                    'harnesses',
                    'voice',
                    'general',
                  ] as const
                ).map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    className={mainTab === tab ? 'active' : ''}
                    onClick={() => setMainTab(tab)}
                  >
                    {tab === 'models'
                      ? 'Model roles'
                      : tab === 'connections'
                        ? 'Connections'
                        : tab === 'harnesses'
                          ? 'Harnesses'
                          : tab === 'voice'
                            ? 'Voice'
                            : 'General'}
                  </button>
                ))}
              </nav>
              {mainTab === 'connections' && (
                <>
                  <nav
                    className="settings-tabs settings-subtabs"
                    aria-label="Chat providers"
                  >
                    {(['omniroute', 'local', 'custom'] as const).map((tab) => (
                      <button
                        type="button"
                        key={tab}
                        className={connectionTab === tab ? 'active' : ''}
                        onClick={() => {
                          setConnectionTab(tab);
                          setProvider((current) => ({
                            ...current,
                            kind:
                              tab === 'local'
                                ? 'hermes'
                                : tab === 'custom'
                                  ? 'custom'
                                  : 'omniroute',
                          }));
                        }}
                      >
                        {tab === 'omniroute'
                          ? 'OmniRoute'
                          : tab === 'local'
                            ? 'Hermes API'
                            : 'Custom host'}
                      </button>
                    ))}
                  </nav>
                  {connectionTab === 'local' && (
                    <p className="muted">
                      This connects ACTUALLY Open Dots to Hermes's model API.
                      Install and manage the Hermes harness separately in
                      Harnesses.
                    </p>
                  )}
                  {connectionTab === 'custom' && (
                    <p className="muted">
                      Use any OpenAI-compatible endpoint, including llama.cpp,
                      Ollama, or a server on another machine.
                    </p>
                  )}
                  <label className="field-label">
                    Saved connection
                    <select
                      value={connectionEditorId}
                      onChange={(e) => {
                        if (e.target.value === '__add__') addConnection();
                        else setConnectionEditorId(e.target.value);
                      }}
                    >
                      {provider.connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.name}
                        </option>
                      ))}
                      <option value="__add__">Add a connection�</option>
                    </select>
                  </label>
                  {connectionTab === 'local' && (
                    <p className="muted">
                      This connects ACTUALLY Open Dots to the Hermes model API.
                      Install and manage the Hermes harness separately in
                      Harnesses.
                    </p>
                  )}
                  {connectionTab === 'custom' && (
                    <p className="muted">
                      Use any OpenAI-compatible endpoint, including llama.cpp,
                      Ollama, or a server on another machine.
                    </p>
                  )}
                  {selectedConnection ? (
                    <>
                      <label className="field-label">
                        Connection name
                        <input
                          value={selectedConnection.name}
                          onChange={(e) =>
                            updateConnection(selectedConnection.id, {
                              name: e.target.value,
                            })
                          }
                          maxLength={80}
                        />
                      </label>
                      <label className="field-label">
                        Provider type
                        <select
                          value={selectedConnection.kind}
                          onChange={(e) =>
                            updateConnection(selectedConnection.id, {
                              kind: e.target
                                .value as typeof selectedConnection.kind,
                              ...(e.target.value === 'openai'
                                ? { baseUrl: 'https://api.openai.com/v1' }
                                : e.target.value === 'grok'
                                  ? { baseUrl: 'https://api.x.ai/v1' }
                                  : e.target.value === 'gemini'
                                    ? {
                                        baseUrl:
                                          'https://generativelanguage.googleapis.com/v1beta/openai/',
                                      }
                                    : {}),
                            })
                          }
                        >
                          <option value="omniroute">OmniRoute</option>
                          <option value="openai">OpenAI</option>
                          <option value="grok">Grok / xAI</option>
                          <option value="gemini">Gemini API key</option>
                          <option value="hermes">Hermes API</option>
                          <option value="custom">
                            OpenAI-compatible / custom
                          </option>
                        </select>
                      </label>
                      <label className="field-label">
                        Endpoint URL
                        <input
                          value={selectedConnection.baseUrl}
                          onChange={(e) =>
                            updateConnection(selectedConnection.id, {
                              baseUrl: e.target.value,
                            })
                          }
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                      <label className="field-label">
                        Default model
                        <input
                          value={selectedConnection.model}
                          onChange={(e) =>
                            updateConnection(selectedConnection.id, {
                              model: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field-label">
                        API key{' '}
                        {selectedConnection.hasApiKey &&
                        !selectedConnection.apiKey
                          ? '(saved; leave blank to keep)'
                          : ''}
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={selectedConnection.apiKey}
                          onChange={(e) =>
                            updateConnection(selectedConnection.id, {
                              apiKey: e.target.value,
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => removeConnection(selectedConnection.id)}
                        disabled={provider.connections.length < 2}
                      >
                        Remove connection
                      </button>
                    </>
                  ) : (
                    <p className="muted">
                      Add a named connection to use it for either model role.
                    </p>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      if (!selectedConnection?.baseUrl) {
                        setProviderNotice(
                          'Select a connection with an endpoint URL.',
                        );
                        return;
                      }
                      setProviderNotice(`Checking ${selectedConnection.name}�`);
                      try {
                        const response = await fetch(
                          '/api/provider-settings/test',
                          {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              target: 'connection',
                              connectionId: selectedConnection.id,
                            }),
                          },
                        );
                        const result = await response.json();
                        setProviderNotice(result.detail || result.error);
                      } catch {
                        setProviderNotice('Endpoint check failed.');
                      }
                    }}
                  >
                    Test selected connection
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!selectedConnection || modelTestBusy}
                    onClick={async () => {
                      if (!selectedConnection) return;
                      const model =
                        selectedConnection.id === provider.residentConnectionId
                          ? provider.model || selectedConnection.model
                          : selectedConnection.id ===
                              provider.housekeepingConnectionId
                            ? provider.housekeepingModel ||
                              selectedConnection.model
                            : selectedConnection.model;
                      setModelTestBusy(true);
                      setProviderNotice(
                        `Sending a short test prompt to ${model}…`,
                      );
                      try {
                        const response = await fetch(
                          '/api/provider-settings/test',
                          {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              target: 'model',
                              connectionId: selectedConnection.id,
                              model,
                              apiKey: selectedConnection.apiKey,
                            }),
                            signal: AbortSignal.timeout(130_000),
                          },
                        );
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error);
                        setProviderNotice(
                          result.detail || 'Model test succeeded.',
                        );
                      } catch (reason) {
                        setProviderNotice(
                          reason instanceof Error &&
                            reason.name === 'TimeoutError'
                            ? 'The model test took over 130 seconds. The request may still be running at the provider.'
                            : reason instanceof Error
                              ? reason.message
                              : 'Model test failed.',
                        );
                      } finally {
                        setModelTestBusy(false);
                      }
                    }}
                  >
                    {modelTestBusy
                      ? 'Waiting for model…'
                      : 'Send a model test prompt'}
                  </button>
                  <p className="muted">
                    Sends “Reply with only: OK” to the selected model so you can
                    verify a real response, not just endpoint reachability.
                  </p>
                  {providerNotice && (
                    <p className="muted" role="status">
                      {providerNotice}
                    </p>
                  )}
                </>
              )}
              {mainTab === 'models' && (
                <>
                  <fieldset className="appearance-fields">
                    <legend>Resident AI</legend>
                    <p className="muted">
                      Uses the connection selected in Connections. Choose the
                      model this Dot should use for normal conversation.
                    </p>
                    <label className="field-label">
                      Model connection
                      <select
                        value={provider.residentConnectionId}
                        onChange={(e) => {
                          const connection = provider.connections.find(
                            (item) => item.id === e.target.value,
                          );
                          setProvider({
                            ...provider,
                            residentConnectionId: e.target.value,
                            model: connection?.model ?? '',
                          });
                        }}
                      >
                        {!provider.residentConnectionId && (
                          <option value="">Choose a connection</option>
                        )}
                        {provider.connections.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      Resident AI model
                      <input
                        list="resident-model-options"
                        value={provider.model}
                        onChange={(e) =>
                          setProvider({ ...provider, model: e.target.value })
                        }
                        placeholder="Type or choose an available model"
                      />
                      <datalist id="resident-model-options">
                        {modelChoices.map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        setProviderNotice('Loading available resident models…');
                        try {
                          const response = await fetch(
                            '/api/provider-settings/test',
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                target: 'connection',
                                connectionId: provider.residentConnectionId,
                              }),
                            },
                          );
                          const result = await response.json();
                          if (!response.ok) throw new Error(result.error);
                          setModelChoices(result.models || []);
                          setProviderNotice(
                            result.models?.length
                              ? `${result.models.length} models found.`
                              : 'Endpoint responded but did not list models.',
                          );
                        } catch (error) {
                          setProviderNotice(
                            error instanceof Error
                              ? error.message
                              : 'Could not load models.',
                          );
                        }
                      }}
                    >
                      Load resident models
                    </button>
                  </fieldset>
                  <fieldset className="appearance-fields">
                    <legend>Housekeeping AI</legend>
                    <p className="muted">
                      Scheduled and background tasks use this role. Select a
                      saved connection and model independently of the resident
                      role, or choose the resident connection to share it.
                    </p>
                    <label className="field-label">
                      Model connection
                      <select
                        value={provider.housekeepingConnectionId}
                        onChange={(e) => {
                          const connection = provider.connections.find(
                            (item) => item.id === e.target.value,
                          );
                          setProvider({
                            ...provider,
                            housekeepingConnectionId: e.target.value,
                            housekeepingModel: connection?.model ?? '',
                          });
                        }}
                      >
                        {!provider.housekeepingConnectionId && (
                          <option value="">Choose a connection</option>
                        )}
                        {provider.connections.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.id === provider.residentConnectionId
                              ? `${connection.name} (same as resident)`
                              : connection.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      Housekeeping model
                      <input
                        list="housekeeping-model-options"
                        value={provider.housekeepingModel}
                        onChange={(e) =>
                          setProvider({
                            ...provider,
                            housekeepingModel: e.target.value,
                          })
                        }
                        placeholder="Blank uses the connection default model"
                      />
                      <datalist id="housekeeping-model-options">
                        {housekeepingModelChoices.map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        setProviderNotice('Loading housekeeping models…');
                        try {
                          const response = await fetch(
                            '/api/provider-settings/test',
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                target: 'connection',
                                connectionId: provider.housekeepingConnectionId,
                              }),
                            },
                          );
                          const result = await response.json();
                          if (!response.ok) throw new Error(result.error);
                          setHousekeepingModelChoices(result.models || []);
                          setProviderNotice(
                            result.models?.length
                              ? `${result.models.length} housekeeping models found.`
                              : 'Endpoint did not list models.',
                          );
                        } catch (error) {
                          setProviderNotice(
                            error instanceof Error
                              ? error.message
                              : 'Could not load models.',
                          );
                        }
                      }}
                    >
                      Load housekeeping models
                    </button>
                  </fieldset>
                </>
              )}
              {mainTab === 'harnesses' && (
                <>
                  {harnessStatusError && (
                    <p className="chat-error" role="alert">
                      Could not read host harness status: {harnessStatusError}
                    </p>
                  )}
                  <p className="muted">
                    Install and check machine-level agent harnesses here. Their
                    model access is configured separately under Connections and
                    Model roles.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={refreshHarnessStatus}
                  >
                    Refresh harness status
                  </button>
                  <>
                    <>
                      <label className="field-label">
                        OpenCode server URL
                        <input
                          value={provider.openCodeUrl}
                          placeholder="http://localhost:4096"
                          onChange={(e) =>
                            setProvider({
                              ...provider,
                              openCodeUrl: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field-label">
                        OpenCode server password{' '}
                        {provider.hasOpenCodePassword &&
                        !provider.openCodePassword
                          ? '(saved; leave blank to keep)'
                          : ''}
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={provider.openCodePassword}
                          onChange={(e) =>
                            setProvider({
                              ...provider,
                              openCodePassword: e.target.value,
                            })
                          }
                        />
                      </label>
                      <p className="muted">
                        OpenCode has a separate session API, so its server check
                        verifies reachability; it does not route ACTUALLY Open
                        Dots chat through the OpenCode agent.
                      </p>
                    </>
                  </>
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        setProviderNotice('Checking OpenCode server…');
                        try {
                          const response = await fetch(
                            '/api/provider-settings/test',
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                target: 'opencode',
                                openCodeUrl: provider.openCodeUrl,
                                openCodePassword: provider.openCodePassword,
                              }),
                            },
                          );
                          const result = await response.json();
                          setProviderNotice(result.detail || result.error);
                        } catch {
                          setProviderNotice('OpenCode check failed.');
                        }
                      }}
                    >
                      Check OpenCode server
                    </button>
                  </>
                  <fieldset className="appearance-fields">
                    <legend>Hermes agent API</legend>
                    <p className="muted">
                      {!harnesses
                        ? 'Checking machine installation status…'
                        : harnesses.hermes.job?.message ||
                          (harnesses?.hermes.running
                            ? 'Running'
                            : harnesses?.hermes.installed
                              ? 'Installed; start it by saving settings or clicking Test.'
                              : 'Not installed')}
                    </p>
                    {!harnesses?.hermes.installed ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          !harnesses ||
                          harnesses.hermes.job?.state === 'installing'
                        }
                        onClick={() => void installHarness('hermes')}
                      >
                        {harnesses
                          ? 'Install and set up Hermes'
                          : 'Checking status…'}
                      </button>
                    ) : (
                      <>
                        {!harnesses.hermes.running && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void startHarness('hermes')}
                          >
                            Start Hermes
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void testHarness('hermes')}
                        >
                          Test Hermes model
                        </button>
                      </>
                    )}
                  </fieldset>
                  <fieldset className="appearance-fields">
                    <legend>OpenCode task harness</legend>
                    <p className="muted">
                      {!harnesses
                        ? 'Checking machine installation status…'
                        : harnesses.opencode.job?.message ||
                          (harnesses?.opencode.running
                            ? `Running at ${harnesses.opencode.url}`
                            : harnesses?.opencode.installed
                              ? 'Installed; not running'
                              : 'Not installed')}
                    </p>
                    {!harnesses?.opencode.installed ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          !harnesses ||
                          harnesses.opencode.job?.state === 'installing'
                        }
                        onClick={() => void installHarness('opencode')}
                      >
                        {harnesses
                          ? 'Install and set up OpenCode'
                          : 'Checking status…'}
                      </button>
                    ) : (
                      <>
                        {!harnesses.opencode.running && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void startHarness('opencode')}
                          >
                            Start OpenCode
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void testHarness('opencode')}
                        >
                          Test OpenCode task harness
                        </button>
                      </>
                    )}
                  </fieldset>
                  {(
                    [
                      [
                        'gemini',
                        'Google Gemini CLI',
                        'Install the standalone Google coding harness on this Ubuntu machine.',
                      ],
                      [
                        'codex',
                        'OpenAI Codex CLI',
                        'Install the Codex command-line harness. Its ChatGPT or API sign-in is managed separately from ACTUALLY Open Dots model connections.',
                      ],
                      [
                        'grok',
                        'Grok Build CLI',
                        'Install the official xAI coding harness on this Ubuntu machine.',
                      ],
                    ] as const
                  ).map(([name, label, description]) => {
                    const harness = harnesses?.[name];
                    return (
                      <fieldset className="appearance-fields" key={name}>
                        <legend>{label}</legend>
                        <p className="muted">{description}</p>
                        <p className="muted">
                          {!harnesses
                            ? 'Checking machine installation status…'
                            : harness?.job?.message ||
                              (harness?.installed
                                ? 'Installed. Run its sign-in flow on the host before using it.'
                                : 'Not installed')}
                        </p>
                        {!harness?.installed ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={
                              !harnesses || harness?.job?.state === 'installing'
                            }
                            onClick={() => void installHarness(name)}
                          >
                            {harnesses
                              ? `Install ${label}`
                              : 'Checking status…'}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => void testHarness(name)}
                            >
                              Check {label} install
                            </button>
                            {(name === 'codex' || name === 'grok') && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={
                                  harness?.job?.state === 'authenticating'
                                }
                                onClick={() => void signInHarness(name)}
                              >
                                Sign in to {label}
                              </button>
                            )}
                          </>
                        )}
                        {name === 'gemini' && (
                          <p className="muted">
                            ACTUALLY Open Dots does not reuse Google-account CLI
                            OAuth for model calls. To use Gemini as a role
                            connection, add a Gemini API key in Connections.
                          </p>
                        )}
                      </fieldset>
                    );
                  })}
                </>
              )}
              {mainTab === 'voice' && (
                <>
                  <fieldset className="appearance-fields voice-settings-group">
                    <legend>Local dictation (Whisper)</legend>
                    <p className="muted">
                      Whisper runs in this browser and inserts recognized text
                      into chat. The model downloads on first use and stays
                      cached by the browser.
                    </p>
                    <label className="field-label">
                      Whisper model
                      <select
                        value={whisperModel}
                        onChange={(e) => setWhisperModel(e.target.value)}
                      >
                        <option value="Xenova/whisper-tiny.en">
                          Whisper Tiny English (fastest)
                        </option>
                        <option value="Xenova/whisper-base.en">
                          Whisper Base English
                        </option>
                        <option value="Xenova/whisper-small.en">
                          Whisper Small English (more accurate, larger download)
                        </option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={whisperProcessing}
                      onClick={() => {
                        localStorage.setItem(
                          'opendots-whisper-model',
                          whisperModel,
                        );
                        void toggleWhisperTest();
                      }}
                    >
                      {whisperRecording
                        ? 'Stop and transcribe'
                        : 'Record a Whisper test'}
                    </button>
                    {whisperTranscript && (
                      <div className="muted" role="status">
                        <strong>Recognized text:</strong> {whisperTranscript}
                      </div>
                    )}
                    <p className="muted">
                      In any chat, use the microphone button beside the message
                      box. It records a short clip and inserts Whisper’s
                      transcript into your draft; nothing is sent until you
                      press Send.
                    </p>
                    {!globalThis.isSecureContext && (
                      <p className="chat-error" role="status">
                        Browser microphone access needs HTTPS or localhost. This
                        page is not being treated as secure, so Whisper cannot
                        record until you open a secure URL.
                      </p>
                    )}
                  </fieldset>
                  <fieldset className="appearance-fields voice-settings-group">
                    <legend>Live voice calls</legend>
                    <p className="muted">
                      Live speech-to-speech uses its own realtime endpoint and
                      model, separate from chat and local Whisper dictation.
                    </p>
                    <label className="field-label">
                      Realtime voice endpoint
                      <input
                        value={provider.voiceBaseUrl}
                        placeholder="https://api.openai.com/v1"
                        onChange={(e) =>
                          setProvider({
                            ...provider,
                            voiceBaseUrl: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Realtime voice model
                      <select
                        value={provider.voiceModel}
                        onChange={(e) =>
                          setProvider({
                            ...provider,
                            voiceModel: e.target.value,
                          })
                        }
                      >
                        {!voiceModelChoices.length && provider.voiceModel && (
                          <option value={provider.voiceModel}>
                            {provider.voiceModel} (saved)
                          </option>
                        )}
                        {voiceModelChoices.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        setProviderNotice('Loading voice models…');
                        try {
                          const response = await fetch(
                            '/api/provider-settings/test',
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                target: 'voice',
                                voiceBaseUrl: provider.voiceBaseUrl,
                                voiceKey: provider.voiceKey,
                              }),
                            },
                          );
                          const result = await response.json();
                          if (!response.ok) throw new Error(result.error);
                          setVoiceModelChoices(result.models || []);
                          setProviderNotice(
                            result.models?.length
                              ? `${result.models.length} voice endpoint models found.`
                              : 'Voice endpoint did not list models.',
                          );
                        } catch (error) {
                          setProviderNotice(
                            error instanceof Error
                              ? error.message
                              : 'Could not load voice models.',
                          );
                        }
                      }}
                    >
                      Load voice models
                    </button>
                    <label className="field-label">
                      Voice API key{' '}
                      {provider.hasVoiceKey && !provider.voiceKey
                        ? '(saved; leave blank to keep)'
                        : ''}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={provider.voiceKey}
                        onChange={(e) =>
                          setProvider({ ...provider, voiceKey: e.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Spoken voice
                      <select
                        value={provider.voiceName}
                        onChange={(e) =>
                          setProvider({
                            ...provider,
                            voiceName: e.target.value,
                          })
                        }
                      >
                        {[
                          'alloy',
                          'ash',
                          'ballad',
                          'cedar',
                          'coral',
                          'echo',
                          'marin',
                          'sage',
                          'shimmer',
                          'verse',
                        ].map((voice) => (
                          <option key={voice} value={voice}>
                            {voice[0].toUpperCase() + voice.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                </>
              )}
              {mainTab === 'general' && (
                <>
                  <label className="permission-row">
                    <input
                      type="checkbox"
                      checked={research}
                      onChange={(e) => setResearch(e.target.checked)}
                    />
                    <span>
                      <strong>Public-page research</strong>
                      <small>
                        Allow the server-side read-only browser tool. This
                        setting applies to all Dots.
                      </small>
                    </span>
                  </label>
                  <label className="permission-row">
                    <input
                      type="checkbox"
                      checked={memory}
                      onChange={(e) => setMemory(e.target.checked)}
                    />
                    <span>
                      <strong>Use saved memories</strong>
                      <small>
                        Include saved preferences in new turns. Changing this
                        stops active work.
                      </small>
                    </span>
                  </label>
                  <fieldset className="appearance-fields">
                    <legend>Appearance</legend>
                    <div className="segmented" role="radiogroup">
                      {(['system', 'light', 'dark'] as ThemePreference[]).map(
                        (option) => (
                          <label key={option}>
                            <input
                              type="radio"
                              name="theme"
                              value={option}
                              checked={theme === option}
                              onChange={() => {
                                setTheme(option);
                                setThemePreference(option);
                              }}
                            />
                            <span>
                              {option[0].toUpperCase() + option.slice(1)}
                            </span>
                          </label>
                        ),
                      )}
                    </div>
                    <p className="muted">
                      Saved in this browser. System follows your device.
                    </p>
                  </fieldset>
                </>
              )}
            </>
          )}
          {dialog.type === 'memory' && (
            <p className="muted">
              Memories are explicit preferences, not automatic learning. Avoid
              secrets; enabled memories go to your model provider.
            </p>
          )}
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </section>
    </div>
  );
}
