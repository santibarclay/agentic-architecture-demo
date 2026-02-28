'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentEvent =
  | { type: 'supervisor_start'; message: string }
  | { type: 'supervisor_plan'; searchTerm: string; responseFormat: string; raw: string }
  | { type: 'supervisor_delegate'; instructions: string }
  | { type: 'researcher_start' }
  | { type: 'researcher_thinking'; text: string }
  | { type: 'researcher_tool_call'; tool: string; input: Record<string, string> }
  | { type: 'researcher_tool_result'; tool: string; result: string }
  | { type: 'researcher_done'; summary: string }
  | { type: 'synthesizer_start' }
  | { type: 'synthesizer_done'; answer: string }
  | { type: 'supervisor_done' }
  | { type: 'error'; message: string };

type LogEntry = AgentEvent & { id: number };

type AgentStatus = 'idle' | 'working' | 'done' | 'error';

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', note: 'Más capaz' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Equilibrado' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'Más rápido' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModelSelector({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs font-semibold uppercase tracking-widest ${color}`}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500 cursor-pointer"
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.note}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === 'idle') return <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" />;
  if (status === 'working')
    return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block animate-pulse" />;
  if (status === 'done') return <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />;
}

function EventLine({ entry }: { entry: LogEntry }) {
  const base = 'text-xs font-mono leading-relaxed py-0.5';

  switch (entry.type) {
    case 'supervisor_start':
    case 'supervisor_delegate':
      return (
        <p className={`${base} text-purple-300`}>
          <span className="text-purple-500 mr-1">▶</span>
          {entry.type === 'supervisor_start' ? entry.message : entry.instructions}
        </p>
      );
    case 'supervisor_plan':
      return (
        <div className={`${base} text-purple-200`}>
          <p>
            <span className="text-purple-500 mr-1">📋</span>
            <span className="text-gray-400">Buscar:</span>{' '}
            <span className="text-white font-semibold">{entry.searchTerm}</span>
          </p>
          <p>
            <span className="text-purple-500 mr-1">📝</span>
            <span className="text-gray-400">Formato:</span> {entry.responseFormat}
          </p>
        </div>
      );
    case 'supervisor_done':
      return (
        <p className={`${base} text-green-400`}>
          <span className="mr-1">✓</span> Pipeline completado exitosamente
        </p>
      );
    case 'researcher_start':
      return (
        <p className={`${base} text-emerald-400`}>
          <span className="mr-1">🔍</span> Iniciando investigación...
        </p>
      );
    case 'researcher_thinking':
      return (
        <p className={`${base} text-gray-400 italic`}>
          <span className="mr-1">💭</span>
          {entry.text.length > 120 ? entry.text.slice(0, 120) + '…' : entry.text}
        </p>
      );
    case 'researcher_tool_call':
      return (
        <div className={`${base} text-emerald-300`}>
          <p>
            <span className="text-emerald-500 mr-1">⚡</span>
            <span className="text-emerald-400 font-semibold">{entry.tool}</span>
            {entry.tool === 'search_wikipedia' && (
              <span className="text-gray-300">({entry.input.query})</span>
            )}
            {entry.tool === 'get_wikipedia_article' && (
              <span className="text-gray-300">({entry.input.title})</span>
            )}
          </p>
        </div>
      );
    case 'researcher_tool_result':
      return (
        <p className={`${base} text-gray-400 pl-4 border-l border-gray-700`}>
          {entry.result}
        </p>
      );
    case 'researcher_done':
      return (
        <p className={`${base} text-green-400`}>
          <span className="mr-1">✓</span> Investigación completada
        </p>
      );
    case 'synthesizer_start':
      return (
        <p className={`${base} text-amber-400`}>
          <span className="mr-1">✨</span> Sintetizando respuesta...
        </p>
      );
    case 'synthesizer_done':
      return (
        <p className={`${base} text-green-400`}>
          <span className="mr-1">✓</span> Síntesis completada
        </p>
      );
    case 'error':
      return (
        <p className={`${base} text-red-400`}>
          <span className="mr-1">✗</span> Error: {entry.message}
        </p>
      );
    default:
      return null;
  }
}

function AgentCard({
  title,
  model,
  color,
  icon,
  status,
  entries,
}: {
  title: string;
  model: string;
  color: string;
  icon: string;
  status: AgentStatus;
  entries: LogEntry[];
}) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;

  return (
    <div
      className={`flex flex-col rounded-xl border ${color} bg-gray-900 overflow-hidden transition-all duration-300 ${
        status === 'working' ? 'shadow-lg shadow-current/10' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <span className="text-lg">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-white truncate">{title}</span>
            <StatusDot status={status} />
          </div>
          <p className="text-xs text-gray-500 truncate">{modelLabel}</p>
        </div>
      </div>

      {/* Log */}
      <div
        ref={logRef}
        className="agent-log flex-1 overflow-y-auto p-3 space-y-0.5 min-h-[120px] max-h-[240px]"
      >
        {entries.length === 0 ? (
          <p className="text-xs text-gray-600 italic">En espera...</p>
        ) : (
          entries.map((e) => <EventLine key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [question, setQuestion] = useState('');
  const [supervisorModel, setSupervisorModel] = useState('claude-sonnet-4-6');
  const [researcherModel, setResearcherModel] = useState('claude-sonnet-4-6');
  const [synthesizerModel, setSynthesizerModel] = useState('claude-sonnet-4-6');

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [error, setError] = useState('');

  const [supervisorStatus, setSupervisorStatus] = useState<AgentStatus>('idle');
  const [researcherStatus, setResearcherStatus] = useState<AgentStatus>('idle');
  const [synthesizerStatus, setSynthesizerStatus] = useState<AgentStatus>('idle');

  const [supervisorLog, setSupervisorLog] = useState<LogEntry[]>([]);
  const [researcherLog, setResearcherLog] = useState<LogEntry[]>([]);
  const [synthesizerLog, setSynthesizerLog] = useState<LogEntry[]>([]);

  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  const reset = () => {
    setRunning(false);
    setDone(false);
    setFinalAnswer('');
    setError('');
    setSupervisorStatus('idle');
    setResearcherStatus('idle');
    setSynthesizerStatus('idle');
    setSupervisorLog([]);
    setResearcherLog([]);
    setSynthesizerLog([]);
    idRef.current = 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || running) return;

    reset();
    setRunning(true);
    setSupervisorStatus('working');

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, supervisorModel, researcherModel, synthesizerModel }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: AgentEvent;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          const entry: LogEntry = { ...event, id: nextId() };

          switch (event.type) {
            case 'supervisor_start':
            case 'supervisor_plan':
            case 'supervisor_delegate':
              setSupervisorLog((l) => [...l, entry]);
              break;

            case 'supervisor_done':
              setSupervisorLog((l) => [...l, entry]);
              setSupervisorStatus('done');
              break;

            case 'researcher_start':
            case 'researcher_thinking':
            case 'researcher_tool_call':
            case 'researcher_tool_result':
              setSupervisorStatus('done');
              setResearcherStatus('working');
              setResearcherLog((l) => [...l, entry]);
              break;

            case 'researcher_done':
              setResearcherLog((l) => [...l, entry]);
              setResearcherStatus('done');
              break;

            case 'synthesizer_start':
              setSynthesizerStatus('working');
              setSynthesizerLog((l) => [...l, entry]);
              break;

            case 'synthesizer_done':
              setSynthesizerLog((l) => [...l, entry]);
              setSynthesizerStatus('done');
              setFinalAnswer(event.answer);
              break;

            case 'error':
              setSupervisorStatus((s) => (s === 'working' ? 'error' : s));
              setResearcherStatus((s) => (s === 'working' ? 'error' : s));
              setSynthesizerStatus((s) => (s === 'working' ? 'error' : s));
              setError(event.message);
              setSupervisorLog((l) => [...l, entry]);
              break;
          }
        }
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunning(false);
    }
  };

  const examples = [
    '¿Qué es RAG (Retrieval Augmented Generation)?',
    'How do transformer neural networks work?',
    '¿Cómo funciona la memoria en los modelos de lenguaje?',
    'What is the attention mechanism in deep learning?',
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              Agentic Architecture Demo
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Supervisor · Researcher · Synthesizer — powered by Claude
            </p>
          </div>
          <a
            href="https://github.com"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            GitHub →
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 flex flex-col gap-8">
        {/* Input section */}
        <section>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Question */}
            <div className="relative">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Haz una pregunta sobre cualquier concepto de IA, tecnología o ciencia..."
                rows={3}
                disabled={running}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:opacity-50 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }}
              />
            </div>

            {/* Examples */}
            <div className="flex flex-wrap gap-2">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuestion(ex)}
                  disabled={running}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40"
                >
                  {ex}
                </button>
              ))}
            </div>

            {/* Model selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-gray-900 border border-gray-800">
              <ModelSelector
                label="Supervisor"
                value={supervisorModel}
                onChange={setSupervisorModel}
                color="text-purple-400"
              />
              <ModelSelector
                label="Researcher"
                value={researcherModel}
                onChange={setResearcherModel}
                color="text-emerald-400"
              />
              <ModelSelector
                label="Synthesizer"
                value={synthesizerModel}
                onChange={setSynthesizerModel}
                color="text-amber-400"
              />
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!question.trim() || running}
                className="flex-1 sm:flex-none px-6 py-2.5 bg-white text-gray-900 font-semibold text-sm rounded-xl hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? 'Investigando...' : 'Investigar'}
              </button>
              {(running || done) && (
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 py-2.5 border border-gray-700 text-gray-400 text-sm rounded-xl hover:border-gray-500 hover:text-gray-200 transition-colors"
                >
                  Reiniciar
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Agent pipeline — shown when active */}
        {(running || done) && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
              Pipeline de agentes
            </h2>

            {/* Flow diagram */}
            <div className="flex flex-col sm:flex-row items-stretch gap-2 sm:gap-0">
              {/* Supervisor */}
              <div className="flex-1">
                <AgentCard
                  title="Supervisor"
                  model={supervisorModel}
                  color="border-purple-800"
                  icon="🧠"
                  status={supervisorStatus}
                  entries={supervisorLog}
                />
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center px-3 text-gray-600 text-lg select-none">
                <span className="hidden sm:block">→</span>
                <span className="sm:hidden">↓</span>
              </div>

              {/* Researcher */}
              <div className="flex-1">
                <AgentCard
                  title="Researcher"
                  model={researcherModel}
                  color="border-emerald-800"
                  icon="🔍"
                  status={researcherStatus}
                  entries={researcherLog}
                />
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center px-3 text-gray-600 text-lg select-none">
                <span className="hidden sm:block">→</span>
                <span className="sm:hidden">↓</span>
              </div>

              {/* Synthesizer */}
              <div className="flex-1">
                <AgentCard
                  title="Synthesizer"
                  model={synthesizerModel}
                  color="border-amber-800"
                  icon="✨"
                  status={synthesizerStatus}
                  entries={synthesizerLog}
                />
              </div>
            </div>
          </section>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Final answer */}
        {finalAnswer && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
              Respuesta
            </h2>
            <div className="rounded-xl border border-gray-700 bg-gray-900 p-6">
              <div className="markdown">
                <ReactMarkdown>{finalAnswer}</ReactMarkdown>
              </div>
            </div>
          </section>
        )}

        {/* How it works */}
        {!running && !done && (
          <section className="mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-4">
              Cómo funciona
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  icon: '🧠',
                  color: 'text-purple-400',
                  title: 'Supervisor',
                  desc: 'Analiza tu pregunta y determina qué buscar y cómo estructurar la respuesta. Delega tareas a los sub-agentes.',
                },
                {
                  icon: '🔍',
                  color: 'text-emerald-400',
                  title: 'Researcher',
                  desc: 'Usa herramientas para buscar en Wikipedia. Llama a search_wikipedia y get_wikipedia_article en un loop autónomo.',
                },
                {
                  icon: '✨',
                  color: 'text-amber-400',
                  title: 'Synthesizer',
                  desc: 'Toma los datos en bruto del Researcher y produce una respuesta clara y bien formateada en Markdown.',
                },
              ].map((card) => (
                <div key={card.title} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                  <div className={`text-2xl mb-2`}>{card.icon}</div>
                  <h3 className={`font-semibold text-sm mb-1 ${card.color}`}>{card.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-4 text-center">
        <p className="text-xs text-gray-600">
          Open source · Construido con Next.js + Claude API ·{' '}
          <a
            href="https://docs.anthropic.com"
            className="hover:text-gray-400 transition-colors underline"
          >
            Anthropic Docs
          </a>
        </p>
      </footer>
    </div>
  );
}
