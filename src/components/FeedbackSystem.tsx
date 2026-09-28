/**
 * Feedback & reporting system, ported from the "Ami" app:
 *  - ReportModal: flag one specific recommendation (movie/novel/artist) as
 *    offensive, mismatched, or otherwise off — posts to /api/report.
 *  - FeedbackModal: general, not-tied-to-one-item feedback about the app —
 *    posts to /api/feedback.
 * Restyled to match Taar Explorer's cubist/art-deco look (thick borders,
 * hard drop shadows) instead of Ami's rounded sticker style.
 */
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Flag, Star, X, HeartHandshake } from 'lucide-react';
import { CubistIconButton } from './cubist/CubistUI';

export type RecommendationCategory = 'movies' | 'novels' | 'artists';

export interface ReportPayload {
  category: RecommendationCategory;
  itemTitle: string;
  itemAuthor: string;
  itemReason: string;
  aesthetic?: string | null;
  moods?: string[];
  nonce: string;
}

type SubmitStatus = 'idle' | 'sending' | 'sent' | 'error';

const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'offensive', label: 'Inappropriate or offensive' },
  { id: 'mismatched', label: "Doesn't match this aesthetic" },
  { id: 'other', label: 'Other reason' },
];

const overlayClass = 'fixed inset-0 z-[90] bg-[#111111]/60 backdrop-blur-sm flex items-center justify-center p-6';
const panelClass = 'relative w-full max-w-md bg-white text-[#111111] rounded-[2rem] border-[4px] border-[#111111] shadow-[8px_8px_0px_0px_#111111] p-8';
const textAreaClass = 'w-full px-4 py-3 rounded-xl border-[2px] border-[#111111]/20 text-sm mb-4 resize-y focus:outline-none focus:border-[#111111]/50';

function useEscapeKey(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}

/** Flag one specific recommendation as offensive, mismatched, or otherwise off. */
export function ReportModal({
  payload,
  onClose,
  onSubmitted,
}: {
  payload: ReportPayload | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');

  useEffect(() => {
    setReasonId(null);
    setText('');
    setStatus('idle');
  }, [payload]);

  useEscapeKey(onClose, !!payload);

  if (!payload) return null;

  const submit = async () => {
    if (!reasonId || status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: payload.category,
          item_title: payload.itemTitle,
          item_author: payload.itemAuthor,
          item_reason: payload.itemReason,
          aesthetic: payload.aesthetic ?? null,
          moods: payload.moods || [],
          reason_category: reasonId,
          reason_text: text.trim(),
          nonce: payload.nonce,
        }),
      });
      if (!res.ok) throw new Error('bad status');
      setStatus('sent');
      onSubmitted();
    } catch {
      setStatus('error');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className={overlayClass}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.92, y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className={panelClass}
      >
        <CubistIconButton onClick={onClose} aria-label="Close" className="!absolute top-4 right-4 !p-2">
          <X className="w-4 h-4" />
        </CubistIconButton>

        {status === 'sent' ? (
          <div className="text-center py-6">
            <Flag className="w-9 h-9 mx-auto mb-4 text-[#f98b79]" fill="currentColor" />
            <p className="font-black text-lg">Thanks for the report</p>
            <p className="text-[#111111]/60 mt-2 font-medium">We'll take a closer look.</p>
          </div>
        ) : (
          <>
            <h3 className="font-black text-xl mb-1 pr-8">Report this pick</h3>
            <p className="text-sm text-[#111111]/60 font-bold mb-5 truncate">{payload.itemTitle}</p>
            <div className="flex flex-col gap-2 mb-4">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReasonId(r.id)}
                  className={`text-left px-4 py-3 rounded-xl border-[3px] font-bold text-sm transition-colors ${
                    reasonId === r.id ? 'border-[#111111] bg-[#fbd743]' : 'border-[#111111]/15 hover:border-[#111111]/35'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Anything you'd like to add? (optional)"
              rows={3}
              className={textAreaClass}
            />
            {status === 'error' && (
              <p className="text-[#c0392b] text-sm mb-3 font-bold">Couldn't send the report — please try again.</p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!reasonId || status === 'sending'}
              className={`w-full py-3 rounded-full border-[3px] border-[#111111] font-black uppercase tracking-wide text-sm transition-opacity disabled:cursor-not-allowed ${
                reasonId ? 'bg-[#111111] text-white' : 'bg-[#111111]/10 text-[#111111]/40'
              }`}
            >
              {status === 'sending' ? 'Sending...' : 'Send report'}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/** General, not-tied-to-one-item feedback about the app. */
export function FeedbackModal({
  open,
  onClose,
  onSubmitted,
  lastAesthetic,
  lastMoods,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  lastAesthetic?: string | null;
  lastMoods?: string[] | null;
  sessionId: string;
}) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [accurate, setAccurate] = useState<boolean | null>(null);
  const [usefulRecs, setUsefulRecs] = useState<boolean | null>(null);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [whyNot, setWhyNot] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');

  useEscapeKey(onClose, open);

  if (!open) return null;

  const hasAnyAnswer = !!(rating || accurate !== null || usefulRecs !== null || wouldRecommend !== null || comment.trim());

  const submit = async () => {
    if (!hasAnyAnswer || status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: rating || null,
          accurate,
          useful_recommendations: usefulRecs,
          would_recommend: wouldRecommend,
          why_not: whyNot.trim(),
          comment: comment.trim(),
          last_aesthetic: lastAesthetic || null,
          last_moods: lastMoods || [],
          nonce: sessionId,
        }),
      });
      if (!res.ok) throw new Error('bad status');
      setStatus('sent');
      onSubmitted();
    } catch {
      setStatus('error');
    }
  };

  const resetAndClose = () => {
    onClose();
    setTimeout(() => {
      setRating(0);
      setAccurate(null);
      setUsefulRecs(null);
      setWouldRecommend(null);
      setWhyNot('');
      setComment('');
      setStatus('idle');
    }, 300);
  };

  const pill = (active: boolean) =>
    `px-4 py-2 rounded-full border-[3px] font-bold text-sm whitespace-nowrap transition-colors ${
      active ? 'border-[#111111] bg-[#fbd743]' : 'border-[#111111]/15 hover:border-[#111111]/35'
    }`;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={resetAndClose}
      className={`${overlayClass} overflow-y-auto`}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.92, y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className={`${panelClass} max-h-[90vh] overflow-y-auto`}
      >
        <CubistIconButton onClick={resetAndClose} aria-label="Close" className="!absolute top-4 right-4 !p-2">
          <X className="w-4 h-4" />
        </CubistIconButton>

        {status === 'sent' ? (
          <div className="text-center py-6">
            <HeartHandshake className="w-9 h-9 mx-auto mb-4 text-[#ff9cbf]" />
            <p className="font-black text-lg">Thank you!</p>
            <p className="text-[#111111]/60 mt-2 font-medium">Your feedback helps us make Taar Explorer better.</p>
          </div>
        ) : (
          <>
            <h3 className="font-black text-xl mb-1 pr-8">Your feedback</h3>
            <p className="text-sm text-[#111111]/60 font-medium mb-5">Tell us what's working, or what isn't.</p>

            <div className="flex gap-1 justify-center mb-5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  className="p-1"
                >
                  <Star size={28} fill={(hoverRating || rating) >= n ? '#fbd743' : 'none'} className="text-[#111111]" />
                </button>
              ))}
            </div>

            <FeedbackQuestion label="Did the analysis feel accurate?">
              <button type="button" className={pill(accurate === true)} onClick={() => setAccurate(true)}>Yes</button>
              <button type="button" className={pill(accurate === false)} onClick={() => setAccurate(false)}>No</button>
            </FeedbackQuestion>

            <FeedbackQuestion label="Were the movie/novel/artist picks relevant?">
              <button type="button" className={pill(usefulRecs === true)} onClick={() => setUsefulRecs(true)}>Yes</button>
              <button type="button" className={pill(usefulRecs === false)} onClick={() => setUsefulRecs(false)}>No</button>
            </FeedbackQuestion>

            <FeedbackQuestion label="Would you recommend Taar Explorer?">
              <button type="button" className={pill(wouldRecommend === true)} onClick={() => { setWouldRecommend(true); setWhyNot(''); }}>Yes</button>
              <button type="button" className={pill(wouldRecommend === false)} onClick={() => setWouldRecommend(false)}>No</button>
            </FeedbackQuestion>

            {wouldRecommend === false && (
              <textarea
                value={whyNot}
                onChange={(e) => setWhyNot(e.target.value)}
                placeholder="Mind telling us why not?"
                rows={2}
                className={textAreaClass}
              />
            )}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything else you'd like to share? (optional)"
              rows={3}
              className={textAreaClass}
            />

            {status === 'error' && (
              <p className="text-[#c0392b] text-sm mb-3 font-bold">Couldn't send your feedback — please try again.</p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!hasAnyAnswer || status === 'sending'}
              className={`w-full py-3 rounded-full border-[3px] border-[#111111] font-black uppercase tracking-wide text-sm transition-opacity disabled:cursor-not-allowed ${
                hasAnyAnswer ? 'bg-[#111111] text-white' : 'bg-[#111111]/10 text-[#111111]/40'
              }`}
            >
              {status === 'sending' ? 'Sending...' : 'Send feedback'}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function FeedbackQuestion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="font-bold text-sm mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
