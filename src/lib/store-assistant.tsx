import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useAuth } from './app-context'
import { auth } from './firebase'
import { buttonClass, secondaryClass, inputClass, ErrorNotice, Icon } from './ui'

type Message = { role: 'user' | 'assistant'; content: string; checkedAt?: string | null }
const suggestions = [
  'Which products need urgent attention?',
  'What promotions are active?',
  'Which items are low in stock?',
  'How do I record a sale?',
]

export default function StoreAssistant() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [failedQuestion, setFailedQuestion] = useState('')
  const controller = useRef<AbortController | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (open && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [messages, busy, open])
  useEffect(() => {
    if (open) (field.current?.disabled ? closeButton.current : field.current)?.focus()
  }, [open])
  function close() {
    setOpen(false)
    launcher.current?.focus()
  }
  async function ask(value: string, retry = false) {
    const content = value.trim()
    if (!content || busy || !user) return
    const history = retry ? messages.slice(0, -1) : messages
    if (!retry) setMessages([...messages, { role: 'user', content }])
    setQuestion('')
    setError('')
    setFailedQuestion('')
    setBusy(true)
    const request = new AbortController()
    controller.current = request
    const timeout = window.setTimeout(() => request.abort(), 135000)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          history: history
            .slice(-8)
            .map(({ role, content }) => ({ role, content: content.slice(0, 2000) })),
        }),
        signal: request.signal,
      })
      const data = await response
        .json()
        .catch(() => ({ error: 'The assistant returned an invalid response.' }))
      if (!response.ok) throw new Error(data.error || 'The assistant is unavailable.')
      // Never show one account's response after a sign-out/account change.
      if (auth.currentUser?.uid !== user.uid || request.signal.aborted) return
      if (typeof data.answer !== 'string' || !data.answer.trim())
        throw new Error('The assistant returned an invalid response.')
      setMessages((previous) => [
        ...previous,
        { role: 'assistant', content: data.answer, checkedAt: data.checkedAt },
      ])
    } catch (cause) {
      if (auth.currentUser?.uid !== user.uid) return
      setFailedQuestion(content)
      setError(
        request.signal.aborted
          ? 'The request timed out. Please try again.'
          : cause instanceof Error
            ? cause.message
            : 'The assistant is unavailable.'
      )
    } finally {
      window.clearTimeout(timeout)
      setBusy(false)
      controller.current = null
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void ask(question)
  }
  return (
    <div className="fixed inset-x-3 bottom-3 z-30 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6">
      <section
        id="store-assistant"
        hidden={!open}
        aria-labelledby="store-assistant-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:w-md"
      >
        <div className="flex max-h-[calc(100dvh-5rem)] flex-col">
          <header className="flex items-start justify-between gap-2 px-4 py-3">
            <div>
              <h2
                id="store-assistant-title"
                className="font-semibold tracking-tight text-slate-950"
              >
                Store assistant
              </h2>
              <p className="text-xs text-slate-500">Live inventory · read-only</p>
            </div>
            <button
              ref={closeButton}
              type="button"
              onClick={close}
              aria-label="Close store assistant"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </header>
          <div className="border-y border-slate-200 px-4 py-2">
            <button
              type="button"
              disabled={busy || messages.length === 0}
              className={secondaryClass}
              onClick={() => {
                setMessages([])
                setError('')
                setFailedQuestion('')
                field.current?.focus()
              }}
            >
              New conversation
            </button>
          </div>
          <div
            ref={log}
            className="h-80 min-h-0 overflow-y-auto overscroll-contain p-4"
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={busy}
          >
            {messages.length === 0 ? (
              <div>
                <h3 className="text-base font-semibold tracking-tight">
                  What would you like to check?
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-slate-500">
                  Review expiry risks, stock levels, promotions and monthly transactions.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {suggestions.map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={busy}
                      onClick={() => void ask(value)}
                      className="rounded-lg border border-slate-200 px-4 py-3 text-left text-[13px] leading-5 text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline-2 focus-visible:outline-indigo-500"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message, index) => (
                  <article
                    key={index}
                    className={
                      message.role === 'user' ? 'ml-auto max-w-[90%] sm:max-w-[80%]' : 'max-w-full'
                    }
                  >
                    <p
                      className={`mb-1.5 text-[11px] font-semibold ${message.role === 'user' ? 'text-right text-slate-500' : 'text-indigo-600'}`}
                    >
                      {message.role === 'user' ? 'You' : 'Store assistant'}
                    </p>
                    <div
                      className={`whitespace-pre-wrap break-words rounded-xl px-4 py-3 text-[13px] leading-6 ${message.role === 'user' ? 'bg-slate-100 text-slate-800' : 'border border-slate-100 bg-white text-slate-700'}`}
                    >
                      {message.content}
                    </div>
                    {message.checkedAt && (
                      <p className="mt-1.5 text-[10px] text-slate-400">
                        Data checked{' '}
                        {new Date(message.checkedAt).toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Colombo',
                        })}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
            {busy && (
              <p role="status" className="mt-5 flex items-center gap-2 text-xs text-slate-500">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600 motion-reduce:animate-none"
                />
                Checking your question and store records…
              </p>
            )}
          </div>
          <div className="space-y-3 border-t border-slate-200 p-4 sm:px-5">
            <ErrorNotice message={error} />
            {failedQuestion && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void ask(failedQuestion, true)}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Retry last question
              </button>
            )}
            <form onSubmit={submit} className="flex items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Your question</span>
                <textarea
                  ref={field}
                  rows={2}
                  maxLength={2000}
                  required
                  value={question}
                  disabled={busy}
                  placeholder="Ask about your products, expiry dates or stock…"
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      void ask(question)
                    }
                  }}
                  className={`${inputClass} mt-0 resize-none`}
                />
              </label>
              <button
                type="submit"
                disabled={busy || !question.trim()}
                aria-label="Send question"
                className={`${buttonClass} mb-0.5 h-10 px-3`}
              >
                <Icon name="arrow" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </section>
      <button
        ref={launcher}
        type="button"
        aria-expanded={open}
        aria-controls="store-assistant"
        onClick={() => (open ? close() : setOpen(true))}
        className={`${buttonClass} shadow-lg`}
      >
        <Icon name="chat" className="h-5 w-5" />
        Store assistant
      </button>
    </div>
  )
}
