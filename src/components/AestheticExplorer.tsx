import React, { useState, useRef, ChangeEvent, DragEvent, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Loader2, Youtube, BookOpen, MessageSquare, ExternalLink, Sparkles, Film, Book, Palette, X, Check, Eye, EyeOff, Volume2, VolumeX, Home, HeartHandshake, Phone, ShieldAlert, HeartCrack } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAdaptiveAudio } from '../hooks/useAdaptiveAudio';
import {
  CubistTexture,
  CubistCard,
  CubistChip,
  CubistButton,
  CubistIconButton,
  CubistFace,
  TitleWord,
  ScanBeam,
  DecodingPill,
  getContrastColor,
  DEFAULT_PALETTE,
} from './cubist/CubistUI';

interface SearchCategory {
  categoryName: string;
  youtubeQueries: string[];
  wikipediaQueries: string[];
  redditQueries: string[];
}

interface AnalysisResult {
  mood: string[];
  aesthetic: string;
  styleDetails: string[];
  twist: {
    hasTwist: boolean;
    description: string;
  };
  colors: string[];
  fonts: string[];
  continents: string[];
  searchCategories: SearchCategory[];
}

// Safety guardrail: when the backend's moderation pass flags an upload,
// /api/analyze returns { safety: { flag } } instead of an AnalysisResult.
// "minor_safety" is a hard block (highest priority — see server.ts); "self_harm"
// and "dangerous" are genuine safety concerns; "death" is not a personal-risk
// signal, it just means we don't turn that photo into a lighthearted "vibe".
// The classifier prompt itself lives in the private orchestration module.
type SafetyFlagType = 'self_harm' | 'dangerous' | 'death' | 'minor_safety';
interface SafetyNotice {
  flag: SafetyFlagType;
  // Whether this notice came from analyzing several images together
  // (analyzeCollection). Kept on the notice itself — not derived from the
  // current images.length — because removing images down to just one left
  // must NOT switch the wording to a confident "this image": we never
  // re-check on removal (see reset()), so we can't be sure the remaining
  // image is actually the one that was flagged.
  fromCollection: boolean;
}
interface AnalyzeApiResponse extends Partial<AnalysisResult> {
  safety?: SafetyNotice;
  error?: string;
}

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  isAnalyzing: boolean;
  result: AnalysisResult | null;
  safety: SafetyNotice | null;
  error: string | null;
  movies: Recommendation[] | null;
  loadingMovies: boolean;
  novels: Recommendation[] | null;
  loadingNovels: boolean;
  artists: Recommendation[] | null;
  loadingArtists: boolean;
  mismatch: string | null;
  loadingMismatch: boolean;
  annotations: { x: number; y: number; comment: string }[] | null;
  isAnnotating: boolean;
  dismissedTwist?: boolean;
}

interface Recommendation {
  title: string;
  authorOrDirector: string;
  reason: string;
  imageUrl?: string;
}

// Category accent colors, borrowed straight from the Cubist Notes palette.
const ACCENT = {
  pink: '#ff9cbf',
  blue: '#7acaea',
  yellow: '#fbd743',
  coral: '#f98b79',
  mint: '#a3e4a1',
};

// Safety guardrail notice — shown instead of the playful "vibe" result
// whenever the backend's moderation pass flags an upload. Deliberately
// calm, non-judgmental, and free of any aesthetic/hashtag language.
// `isCollection` adapts the wording: when several images were analyzed
// together, the flagged content may be just ONE of them, not necessarily
// the one currently previewed — so we say "one of these images" instead
// of "this image".
const SafetyNoticeCard: React.FC<{ flag: SafetyFlagType; onRemove: () => void; isCollection: boolean }> = ({ flag, onRemove, isCollection }) => {
  if (flag === 'minor_safety') {
    // Deliberately terse and non-descriptive: no elaboration, no "why",
    // no empathetic framing — just a firm, neutral refusal to process.
    return (
      <CubistCard className="w-full !bg-white text-left p-5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full shrink-0" style={{ backgroundColor: `${ACCENT.coral}40` }}>
            <ShieldAlert className="w-5 h-5 text-[#111111]" />
          </div>
          <p className="font-black uppercase tracking-wide text-sm sm:text-base">This content isn't allowed here</p>
        </div>
        <p className="text-sm font-medium text-[#111111]/80 leading-relaxed">
          {isCollection
            ? "This tool can't process this set of images."
            : "This tool can't process this image."}
        </p>
        <button
          onClick={onRemove}
          className="w-full py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-transparent hover:bg-[#111111]/5 text-[#111111]/60 hover:text-[#111111]"
        >
          {isCollection ? "Remove this image" : "Remove image"}
        </button>
      </CubistCard>
    );
  }

  if (flag === 'self_harm') {
    return (
      <CubistCard className="w-full !bg-white text-left p-5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full shrink-0" style={{ backgroundColor: `${ACCENT.pink}40` }}>
            <HeartHandshake className="w-5 h-5 text-[#111111]" />
          </div>
          <p className="font-black uppercase tracking-wide text-sm sm:text-base">
            {isCollection ? "We noticed something in one of these photos" : "We noticed something in this photo"}
          </p>
        </div>
        <p className="text-sm font-medium text-[#111111]/80 leading-relaxed">
          {isCollection
            ? "One of the photos in this set looks like it could be about self-harm or a suicidal crisis. We haven't run an aesthetic analysis on this set — if this is about you, please know you don't have to go through it alone, and reaching out really can help."
            : "This looks like it could be about self-harm or a suicidal crisis. We haven't run an aesthetic analysis on it — if this is about you, please know you don't have to go through it alone, and reaching out really can help."}
        </p>
        <div className="rounded-xl border-[3px] border-[#111111] p-3 text-sm font-bold bg-[#fef8f0]">
          <p className="flex items-center gap-2"><Phone className="w-4 h-4 shrink-0" /> France: call or text 3114 — free, 24/7 national suicide prevention line.</p>
          <p className="mt-1.5 text-[#111111]/70 font-medium">Outside France: findahelpline.com lists local, free helplines — or contact your local emergency number.</p>
        </div>
        <button
          onClick={onRemove}
          className="w-full py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-transparent hover:bg-[#111111]/5 text-[#111111]/60 hover:text-[#111111]"
        >
          {isCollection ? "Remove this image" : "Remove image"}
        </button>
      </CubistCard>
    );
  }

  if (flag === 'dangerous') {
    return (
      <CubistCard className="w-full !bg-white text-left p-5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full shrink-0" style={{ backgroundColor: `${ACCENT.coral}40` }}>
            <ShieldAlert className="w-5 h-5 text-[#111111]" />
          </div>
          <p className="font-black uppercase tracking-wide text-sm sm:text-base">Can't analyze this one</p>
        </div>
        <p className="text-sm font-medium text-[#111111]/80 leading-relaxed">
          {isCollection
            ? "One of the images in this set appears to show real weapons, violence, or otherwise dangerous content, so we're not running this set through the aesthetic decoder."
            : "This image appears to show real weapons, violence, or otherwise dangerous content, so we're not running it through the aesthetic decoder."}
        </p>
        <button
          onClick={onRemove}
          className="w-full py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-transparent hover:bg-[#111111]/5 text-[#111111]/60 hover:text-[#111111]"
        >
          {isCollection ? "Remove this image" : "Remove image"}
        </button>
      </CubistCard>
    );
  }

  // flag === 'death'
  return (
    <CubistCard className="w-full !bg-white text-left p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-full shrink-0" style={{ backgroundColor: `${ACCENT.blue}40` }}>
          <HeartCrack className="w-5 h-5 text-[#111111]" />
        </div>
        <p className="font-black uppercase tracking-wide text-sm sm:text-base">No vibe check for this one</p>
      </div>
      <p className="text-sm font-medium text-[#111111]/80 leading-relaxed">
        {isCollection
          ? "One of the images in this set appears to show a real deceased person. Out of respect, we don't turn photos like this into a lighthearted aesthetic breakdown or recommendations."
          : "This image appears to show a real deceased person. Out of respect, we don't turn photos like this into a lighthearted aesthetic breakdown or recommendations."}
      </p>
      <button
        onClick={onRemove}
        className="w-full py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-transparent hover:bg-[#111111]/5 text-[#111111]/60 hover:text-[#111111]"
      >
        {isCollection ? "Remove this image" : "Remove image"}
      </button>
    </CubistCard>
  );
};

export default function AestheticExplorer() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const [isDragging, setIsDragging] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [hoveredAnnIndex, setHoveredAnnIndex] = useState<number | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [fontTestText, setFontTestText] = useState("The quick brown fox jumps over the lazy dog.");
  const [fontTestColor, setFontTestColor] = useState<string | null>(null);

  const activeImage = images[activeIndex];
  const file = activeImage?.file || null;
  const previewUrl = activeImage?.previewUrl || null;
  const isAnalyzing = activeImage?.isAnalyzing || false;
  const result = activeImage?.result || null;
  const safety = activeImage?.safety || null;

  const { isPlaying, togglePlay } = useAdaptiveAudio(result);

  const error = activeImage?.error || null;
  const movies = activeImage?.movies || null;
  const loadingMovies = activeImage?.loadingMovies || false;
  const novels = activeImage?.novels || null;
  const loadingNovels = activeImage?.loadingNovels || false;
  const artists = activeImage?.artists || null;
  const loadingArtists = activeImage?.loadingArtists || false;
  const mismatch = activeImage?.mismatch || null;
  const loadingMismatch = activeImage?.loadingMismatch || false;
  const annotations = activeImage?.annotations || null;
  const isAnnotating = activeImage?.isAnnotating || false;

  // The palette that drives the cubist chrome (title letters, chips, accents):
  // once an image has been analyzed we use its extracted colors, otherwise
  // we fall back to the default Cubist Notes palette.
  // UI chrome (title letters, tag chips) always uses the fixed default palette —
  // deriving it from the photo's extracted colors could look muddy or clash.
  const palette = DEFAULT_PALETTE;

  const updateActiveImage = (updates: Partial<ImageItem>) => {
    setImages(prev => prev.map((img, idx) => idx === activeIndex ? { ...img, ...updates } : img));
  };

  const isScale1000 = annotations ? annotations.some(a => a.x > 100 || a.y > 100) : false;

  const normalizeCoordinate = (val: number) => {
    // If the data was generated on a 0-1000 scale (even if a point is near 0)
    if (isScale1000) {
      return val / 10;
    }
    // Backward compatibility for 0-100 percentage scale
    if (val <= 1 && val > 0) return val * 100; // Legacy 0-1 decimal
    return val;
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            imageFiles.push(blob);
          }
        }
      }
      if (imageFiles.length > 0) {
        processFiles(imageFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Only set dragging to false if we're leaving the browser window
    if (!e.relatedTarget || (e.relatedTarget as Element).nodeName === 'HTML') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const processFiles = async (files: File[]) => {
    const validFiles = files.filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) {
      if (images.length === 0) {
        // Nothing to update if empty, could set an app level error
      }
      return;
    }

    const newItems: ImageItem[] = await Promise.all(validFiles.map(async (f) => {
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(f);
      });
      return {
        id: Math.random().toString(),
        file: f,
        previewUrl: url,
        isAnalyzing: false,
        result: null,
        safety: null,
        error: null,
        movies: null,
        loadingMovies: false,
        novels: null,
        loadingNovels: false,
        artists: null,
        loadingArtists: false,
        mismatch: null,
        loadingMismatch: false,
        annotations: null,
        isAnnotating: false,
      };
    }));

    setImages(prev => {
      const next = [...prev, ...newItems];
      if (prev.length === 0) {
        setActiveIndex(0);
      } else {
        setActiveIndex(prev.length); // switch to the first newly added image
      }
      return next;
    });
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      const fallbackToReader = () => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      };

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000;
        const MAX_HEIGHT = 1000;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fallbackToReader();
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        fallbackToReader();
      };

      img.src = objectUrl;
    });
  };

  const analyzeImage = async () => {
    if (!file) return;

    updateActiveImage({
      isAnalyzing: true,
      result: null,
      safety: null,
      movies: null,
      novels: null,
      artists: null,
      error: null
    });

    try {
      const base64DataUrl = await compressImage(file);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64DataUrl }),
      });

      if (!response.ok) {
        let errMessage = 'Failed to analyze image (Status: ' + response.status + ')';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errData = await response.json();
            errMessage = errData.error || errMessage;
          }
        } catch (e) {
          // ignore
        }
        throw new Error(errMessage);
      }

      const data: AnalyzeApiResponse = await response.json();
      if (data.safety) {
        // Safety guardrail tripped: show a supportive/safety notice instead
        // of the playful aesthetic result.
        updateActiveImage({ safety: { flag: data.safety.flag, fromCollection: false }, result: null });
      } else {
        updateActiveImage({ result: data as AnalysisResult, safety: null });
      }
    } catch (err: any) {
      console.error(err);
      updateActiveImage({ error: err.message || 'An unexpected error occurred during analysis.' });
    } finally {
      updateActiveImage({ isAnalyzing: false });
    }
  };

  const analyzeCollection = async () => {
    const validImages = images.filter(img => img.file);
    if (validImages.length < 2) return;

    // Set loading state for all images
    setImages(prev => prev.map(img => ({
      ...img,
      isAnalyzing: true,
      result: null,
      safety: null,
      movies: null,
      novels: null,
      artists: null,
      error: null
    })));

    try {
      const base64Promises = validImages.map(img => compressImage(img.file));
      const base64DataUrls = await Promise.all(base64Promises);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ images: base64DataUrls }),
      });

      if (!response.ok) {
        let errMessage = 'Failed to analyze collection (Status: ' + response.status + ')';
        throw new Error(errMessage);
      }

      const data: AnalyzeApiResponse = await response.json();
      if (data.safety) {
        // Safety guardrail tripped for the collection: show the notice on
        // every image instead of the playful aesthetic result. fromCollection
        // is what lets the wording stay hedged even if the set later shrinks
        // down to a single image (see reset() and SafetyNotice above).
        const safetyNotice: SafetyNotice = { flag: data.safety.flag, fromCollection: true };
        setImages(prev => prev.map(img => ({
          ...img,
          safety: safetyNotice,
          result: null,
        })));
      } else {
        // Apply the same result to all images
        setImages(prev => prev.map(img => ({
          ...img,
          result: data as AnalysisResult,
          safety: null,
        })));
      }
    } catch (err: any) {
      console.error(err);
      setImages(prev => prev.map(img => ({
        ...img,
        error: err.message || 'An unexpected error occurred during collection analysis.'
      })));
    } finally {
      setImages(prev => prev.map(img => ({
        ...img,
        isAnalyzing: false
      })));
    }
  };

  const annotateImage = async () => {
    if (!file) return;

    updateActiveImage({ isAnnotating: true, annotations: null, error: null });

    try {
      const base64DataUrl = await compressImage(file);

      const response = await fetch('/api/annotate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64DataUrl }),
      });

      if (!response.ok) {
        let errMessage = 'Failed to annotate image (Status: ' + response.status + ')';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errData = await response.json();
            errMessage = errData.error || errMessage;
          }
        } catch (e) {
          // ignore
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      updateActiveImage({ annotations: data.annotations });
    } catch (err: any) {
      console.error(err);
      updateActiveImage({ error: err.message || 'An unexpected error occurred during annotation.' });
    } finally {
      updateActiveImage({ isAnnotating: false });
    }
  };

  const fetchRecommendations = async (target: 'movies' | 'novels' | 'artists', isMore = false) => {
    if (!result) return;

    // Sub-function to update all images that share this exact result
    const updateSharedImages = (updates: Partial<ImageItem>) => {
      setImages(prev => prev.map(img =>
        img.result === result ? { ...img, ...updates } : img
      ));
    };

    if (target === 'movies') updateSharedImages({ loadingMovies: true });
    else if (target === 'novels') updateSharedImages({ loadingNovels: true });
    else if (target === 'artists') updateSharedImages({ loadingArtists: true });

    try {
      const validImages = images.filter(img => img.result === result && img.file);
      const base64Promises = validImages.map(img => compressImage(img.file));
      const base64DataUrls = await Promise.all(base64Promises);

      let existingTitles: string[] = [];
      if (isMore) {
        if (target === 'movies' && movies) existingTitles = movies.map(m => m.title);
        else if (target === 'novels' && novels) existingTitles = novels.map(n => n.title);
        else if (target === 'artists' && artists) existingTitles = artists.map(a => a.title);
      }

      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, context: result, images: base64DataUrls, existingTitles })
      });

      if (!response.ok) throw new Error('Failed to fetch recommendations');

      const data = await response.json();
      if (target === 'movies') updateSharedImages({ movies: isMore && movies ? [...movies, ...data] : data });
      else if (target === 'novels') updateSharedImages({ novels: isMore && novels ? [...novels, ...data] : data });
      else if (target === 'artists') updateSharedImages({ artists: isMore && artists ? [...artists, ...data] : data });
    } catch (error) {
      console.error(error);
    } finally {
      if (target === 'movies') updateSharedImages({ loadingMovies: false });
      else if (target === 'novels') updateSharedImages({ loadingNovels: false });
      else if (target === 'artists') updateSharedImages({ loadingArtists: false });
    }
  };

  const findMismatches = async () => {
    const validImages = images.filter(img => img.file);
    if (validImages.length < 2) return;

    // We only care about images that share this result
    const updateSharedImages = (updates: Partial<ImageItem>) => {
      setImages(prev => prev.map(img =>
        img.result === result ? { ...img, ...updates } : img
      ));
    };

    updateSharedImages({ loadingMismatch: true });

    try {
      const base64Promises = validImages.filter(img => img.result === result).map(img => compressImage(img.file));
      const base64DataUrls = await Promise.all(base64Promises);

      const response = await fetch('/api/mismatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ images: base64DataUrls, context: result }),
      });

      if (!response.ok) {
        throw new Error('Failed to find mismatches');
      }

      const data = await response.json();
      updateSharedImages({ mismatch: data.text });
    } catch (err: any) {
      console.error(err);
      updateSharedImages({ mismatch: err.message || 'Error finding mismatches.' });
    } finally {
      updateSharedImages({ loadingMismatch: false });
    }
  };

  const reset = () => {
    // Deliberately conservative, and cheap: we don't know which image in a
    // shared batch (see analyzeCollection) actually caused a safety flag,
    // so removing one image never clears or re-checks the others — a
    // lingering "self_harm"/"dangerous"/"death"/"minor_safety" notice stays
    // exactly as it is on any image that still carries it. No extra API
    // calls; the notice only goes away once every image in the set has
    // been removed (or the person clears everything with "Back to Home").
    setImages(prev => prev.filter((_, idx) => idx !== activeIndex));
    if (images.length === 1) { // If it was the last image
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveIndex(0);
    } else if (activeIndex >= images.length - 1) {
      setActiveIndex(Math.max(0, images.length - 2));
    }
  };

  const resetAll = () => {
    setImages([]);
    setActiveIndex(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isMismatchClean = mismatch?.trim().toLowerCase() === 'no aesthetic mismatch';

  return (
    <div
      className="min-h-screen bg-[#fef8f0] text-[#111111] font-sans p-4 sm:p-8 pb-24 selection:bg-[#111111] selection:text-white relative overflow-x-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CubistTexture />

      {/* Global Drag Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="fixed inset-0 z-[100] bg-[#fbd743] border-[10px] border-dashed border-[#111111] flex flex-col items-center justify-center"
          >
            <div className="p-6 bg-white rounded-full mb-6 border-[5px] border-[#111111] shadow-[6px_6px_0px_0px_#111111] pointer-events-none">
              <UploadCloud className="w-14 h-14 text-[#111111]" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-wide text-[#111111] mb-2 pointer-events-none">Drop images to upload</h2>
            <p className="text-[#111111]/70 text-lg font-bold pointer-events-none">Add them to your aesthetic collection</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Audio Toggle */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:top-10 lg:right-10 z-[60]">
        <CubistIconButton
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          title={isPlaying ? "Mute immersive audio" : "Play immersive audio"}
          active={isPlaying}
          activeColor={ACCENT.yellow}
        >
          {isPlaying ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </CubistIconButton>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto space-y-10 sm:space-y-12">

        {/* Header */}
        <header className="max-w-5xl mx-auto flex flex-col items-center mt-2 mb-2 px-4">
          <div className="flex flex-col items-center gap-2 sm:gap-3 mb-6">
            <TitleWord word="TAAR" palette={palette} startIndex={0} total={12} />
            <TitleWord word="EXPLORER" palette={palette} startIndex={4} total={12} />
          </div>
          <div className="flex items-center gap-4 max-w-2xl">
            <div className="h-[4px] w-12 rounded-full hidden sm:block bg-[#111111] shrink-0" />
            {result ? (
              <div className="text-center">
                {Array.isArray(result.mood) && result.mood.length > 0 && (
                  <p className="text-xl sm:text-2xl font-black uppercase tracking-wide capitalize leading-tight">
                    {result.mood.join(' · ')}
                  </p>
                )}
                <p className="text-sm sm:text-base font-bold text-[#111111]/60 capitalize">{result.aesthetic}</p>
              </div>
            ) : (
              <p className="text-[#111111]/80 text-sm sm:text-base font-bold leading-relaxed text-center max-w-lg">
                Explore the web differently with an image's semiotic.
              </p>
            )}
            <div className="h-[4px] w-12 rounded-full hidden sm:block bg-[#111111] shrink-0" />
          </div>
        </header>

        {!previewUrl || !result ? (
          /* ============== PRE-RESULT: single centered scan box (mirrors Cubist Notes' flip box) ============== */
          <main className="max-w-2xl mx-auto flex flex-col items-center gap-6 mt-8 sm:mt-16">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              multiple
              className="hidden"
            />

            {images.length > 0 && (
              <div className="w-full flex gap-3 overflow-x-auto pb-1">
                {images.map((img, idx) => (
                  <motion.div
                    key={img.id}
                    onClick={() => setActiveIndex(idx)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`relative min-w-[4.5rem] w-[4.5rem] h-[4.5rem] rounded-xl overflow-hidden cursor-pointer border-[3px] border-[#111111] transition-all ${idx === activeIndex ? 'shadow-[3px_3px_0px_0px_#111111]' : 'opacity-50 hover:opacity-90'}`}
                  >
                    <img src={img.previewUrl} className="w-full h-full object-cover" />
                  </motion.div>
                ))}
                <motion.div
                  onClick={() => fileInputRef.current?.click()}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="min-w-[4.5rem] w-[4.5rem] h-[4.5rem] rounded-xl border-[3px] border-dashed border-[#111111]/40 flex flex-col items-center justify-center cursor-pointer hover:bg-white hover:border-[#111111] transition-colors"
                >
                  <UploadCloud className="w-5 h-5 text-[#111111]/60" />
                </motion.div>
              </div>
            )}

            <div className="w-full min-h-[300px] relative" style={{ perspective: '2000px' }}>
              <motion.div
                animate={{ rotateY: isFlipped ? 180 : 0 }}
                transition={{ duration: 0.8, ease: 'anticipate' }}
                className="w-full h-full relative z-10"
                style={{ transformStyle: 'preserve-3d' }}
              >
                {/* Box FRONT */}
                <motion.div
                  whileHover={{ y: previewUrl ? 0 : -4 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => !previewUrl && fileInputRef.current?.click()}
                  className={`w-full relative bg-white text-[#111111] border-[6px] border-[#111111] shadow-[8px_8px_0px_0px_#111111] rounded-2xl md:rounded-3xl overflow-visible transition-colors duration-300 flex flex-col items-center justify-center p-6 text-center min-h-[300px] ${!previewUrl ? 'cursor-pointer' : ''}`}
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    visibility: isFlipped ? 'hidden' : 'visible',
                    transition: 'visibility 0s linear 0.4s, background-color 300ms',
                  }}
                >
                  {/* TURN flap — right */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsFlipped(true); }}
                    className="absolute -right-9 md:-right-14 top-1/2 -translate-y-1/2 bg-[#fbd743] text-[#111111] border-[5px] md:border-[6px] border-l-0 border-[#111111] shadow-[6px_6px_0px_0px_#111111] md:shadow-[8px_8px_0px_0px_#111111] rounded-r-2xl py-5 md:py-6 px-2 md:px-3 flex items-center justify-center cursor-pointer hover:pl-4 hover:-right-11 md:hover:-right-16 hover:bg-[#ff9cbf] transition-all z-20"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    title="Turn Box"
                  >
                    <span className="font-black uppercase tracking-widest text-sm md:text-lg transform rotate-180">TURN</span>
                  </button>
                  {/* TURN flap — left */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsFlipped(true); }}
                    className="absolute -left-9 md:-left-14 top-1/2 -translate-y-1/2 bg-[#fbd743] text-[#111111] border-[5px] md:border-[6px] border-r-0 border-[#111111] shadow-[-6px_6px_0px_0px_#111111] md:shadow-[-8px_8px_0px_0px_#111111] rounded-l-2xl py-5 md:py-6 px-2 md:px-3 flex items-center justify-center cursor-pointer hover:pr-4 hover:-left-11 md:hover:-left-16 hover:bg-[#ff9cbf] transition-all z-20"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    title="Turn Box"
                  >
                    <span className="font-black uppercase tracking-widest text-sm md:text-lg">TURN</span>
                  </button>

                  {previewUrl ? (
                    <div className="w-full flex flex-col items-center">
                      <div className="w-full relative overflow-hidden border-[4px] border-[#111111] shadow-[4px_4px_0px_0px_#111111] rounded-xl mb-4 bg-[#fef8f0]">
                        <img src={previewUrl} alt="Preview" className="w-full max-h-[500px] object-contain pointer-events-none block relative z-0" />
                        {isAnalyzing && <ScanBeam />}
                      </div>

                      {isAnalyzing ? (
                        <DecodingPill label="Decoding..." />
                      ) : safety ? (
                        <SafetyNoticeCard flag={safety.flag} onRemove={reset} isCollection={safety.fromCollection} />
                      ) : (
                        <div className="w-full flex flex-col gap-3">
                          <CubistButton onClick={analyzeImage} color={ACCENT.yellow} className="w-full">
                            <ImageIcon className="w-5 h-5" />
                            Discover Vibe
                          </CubistButton>
                          {images.length > 1 && (
                            <CubistButton
                              onClick={analyzeCollection}
                              disabled={images.some(img => img.isAnalyzing)}
                              variant="ghost"
                              className="w-full"
                            >
                              {images.some(img => img.isAnalyzing) ? (
                                <>
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                  Analyzing Collection...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-5 h-5" />
                                  Discover Vibe for All {images.length} Images
                                </>
                              )}
                            </CubistButton>
                          )}
                          <button
                            onClick={reset}
                            className="w-full py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-transparent hover:bg-[#111111]/5 text-[#111111]/60 hover:text-[#111111]"
                          >
                            Remove image
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center opacity-80 pointer-events-none relative z-10 py-12">
                      <h2 className="text-3xl md:text-4xl font-black uppercase tracking-widest mb-4">Drop Image Here</h2>
                      <p className="text-lg md:text-xl font-medium">Or click, drag, or paste to decode its aesthetic</p>
                    </div>
                  )}
                </motion.div>

                {/* Box BACK */}
                <div
                  className="w-full h-full absolute inset-0 bg-[#ebf4f6] text-[#111111] border-[6px] border-[#111111] shadow-[8px_8px_0px_0px_#111111] rounded-2xl md:rounded-3xl flex flex-col overflow-visible"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    visibility: !isFlipped ? 'hidden' : 'visible',
                    transition: 'visibility 0s linear 0.4s',
                  }}
                >
                  {/* BACK flap — left */}
                  <button
                    onClick={() => setIsFlipped(false)}
                    className="absolute -left-9 md:-left-14 top-1/2 -translate-y-1/2 bg-[#7acaea] text-[#111111] border-[5px] md:border-[6px] border-r-0 border-[#111111] shadow-[-6px_6px_0px_0px_#111111] md:shadow-[-8px_8px_0px_0px_#111111] rounded-l-2xl py-5 md:py-6 px-2 md:px-3 flex items-center justify-center cursor-pointer hover:pr-4 hover:-left-11 md:hover:-left-16 hover:bg-[#ff9cbf] transition-all z-20"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    title="Turn Back"
                  >
                    <span className="font-black uppercase tracking-widest text-sm md:text-lg">BACK</span>
                  </button>
                  {/* BACK flap — right */}
                  <button
                    onClick={() => setIsFlipped(false)}
                    className="absolute -right-9 md:-right-14 top-1/2 -translate-y-1/2 bg-[#7acaea] text-[#111111] border-[5px] md:border-[6px] border-l-0 border-[#111111] shadow-[6px_6px_0px_0px_#111111] md:shadow-[8px_8px_0px_0px_#111111] rounded-r-2xl py-5 md:py-6 px-2 md:px-3 flex items-center justify-center cursor-pointer hover:pl-4 hover:-right-11 md:hover:-right-16 hover:bg-[#ff9cbf] transition-all z-20"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    title="Turn Back"
                  >
                    <span className="font-black uppercase tracking-widest text-sm md:text-lg transform rotate-180">BACK</span>
                  </button>
                  <div className="w-full h-full rounded-xl overflow-hidden min-h-[300px]">
                    <CubistFace className="w-full h-full" />
                  </div>
                </div>
              </motion.div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full p-4 bg-white border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] rounded-xl text-[#111111] text-sm font-bold"
                style={{ backgroundColor: `${ACCENT.coral}30` }}
              >
                {error}
              </motion.div>
            )}
          </main>
        ) : (
          /* ============== RESULT: 3-column layout, image dead center (mirrors Cubist Notes) ============== */
          <motion.main
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="max-w-7xl mx-auto flex flex-col items-center gap-6"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              multiple
              className="hidden"
            />

            {/* Top bar */}
            <div className="w-full flex items-center justify-between gap-3 flex-wrap">
              <CubistButton onClick={resetAll} variant="ghost" className="!py-2 !px-4 !text-sm">
                <Home className="w-4 h-4" />
                Back to Home
              </CubistButton>
              <CubistButton onClick={() => fileInputRef.current?.click()} color={ACCENT.yellow} className="!py-2 !px-4 !text-sm">
                <UploadCloud className="w-4 h-4" />
                Add Image
              </CubistButton>
            </div>

            {images.length > 1 && (
              <div className="w-full flex gap-3 overflow-x-auto pb-1">
                {images.map((img, idx) => (
                  <motion.div
                    key={img.id}
                    onClick={() => setActiveIndex(idx)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`relative min-w-[4.5rem] w-[4.5rem] h-[4.5rem] rounded-xl overflow-hidden cursor-pointer border-[3px] border-[#111111] transition-all ${idx === activeIndex ? 'shadow-[3px_3px_0px_0px_#111111]' : 'opacity-50 hover:opacity-90'}`}
                  >
                    <img src={img.previewUrl} className="w-full h-full object-cover" />
                  </motion.div>
                ))}
              </div>
            )}

            <div className="w-full flex flex-col lg:flex-row items-start justify-center gap-8">

              {/* LEFT COLUMN */}
              <div className="flex flex-col gap-8 w-full lg:w-1/4">
                <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
                  <CubistCard thick className="p-6">
                    <h3 className="font-black text-xl uppercase tracking-widest mb-4 border-b-[3px] border-[#111111] inline-block self-start">Colors</h3>
                    <div className="flex gap-2 h-16 sm:h-20 w-full mb-2">
                      {Array.isArray(result.colors) && result.colors.map((hex, index) => (
                        <motion.div
                          key={index}
                          whileHover={{ scaleY: 1.08 }}
                          onClick={() => setFontTestColor(fontTestColor === hex ? null : hex)}
                          className={`flex-1 border-[3px] border-[#111111] rounded-lg origin-bottom cursor-pointer transition-shadow ${fontTestColor === hex ? 'shadow-[3px_3px_0px_0px_#111111] scale-y-105' : 'shadow-[2px_2px_0px_0px_#111111]'}`}
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2 w-full text-center">
                      {Array.isArray(result.colors) && result.colors.map((hex, index) => (
                        <span key={index} className="flex-1 font-mono text-[9px] sm:text-[10px] font-bold uppercase truncate opacity-60">{hex}</span>
                      ))}
                    </div>
                  </CubistCard>
                </motion.div>

                <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
                  <CubistCard
                    thick
                    className="p-6"
                    style={result?.fonts?.[0] ? { fontFamily: `"${result.fonts[0]}", system-ui, sans-serif` } : undefined}
                  >
                    <h3 className="font-black text-xl uppercase tracking-widest mb-4 border-b-[3px] border-[#111111] inline-block self-start font-sans">Typography</h3>
                    <input
                      type="text"
                      value={fontTestText}
                      onChange={(e) => setFontTestText(e.target.value)}
                      placeholder="Test the fonts..."
                      className="w-full bg-white border-[3px] border-[#111111] text-[#111111] rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#111111]/30 transition-all mb-3 font-sans"
                    />
                    <div className="flex flex-col gap-3">
                      {Array.isArray(result.fonts) && result.fonts.map((font, index) => (
                        <FontHoverPreview key={index} font={font} text={fontTestText} color={fontTestColor} />
                      ))}
                    </div>
                  </CubistCard>
                </motion.div>
              </div>

              {/* CENTER COLUMN: IMAGE */}
              <div className="flex-1 flex flex-col items-center gap-4 max-w-2xl">

                <motion.div
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2 }}
                  className="w-full bg-white text-[#111111] border-[6px] border-[#111111] shadow-[8px_8px_0px_0px_#111111] rounded-2xl md:rounded-3xl p-4 relative z-20 overflow-visible group"
                >
                  <div
                    className="relative w-full cursor-pointer bg-[#fef8f0] rounded-xl"
                    onClick={() => setIsImageModalOpen(true)}
                  >
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-full h-auto max-h-[70vh] object-contain block border-[4px] border-[#111111] rounded-xl group-hover:brightness-95 transition-all"
                    />
                    {isAnnotating && <ScanBeam />}

                    {annotations && annotations.length > 0 && (
                      <div className="absolute top-3 left-3 z-[60]" onClick={(e) => e.stopPropagation()}>
                        <CubistIconButton
                          onClick={(e) => { e.stopPropagation(); setShowAnnotations(prev => !prev); }}
                          title={showAnnotations ? "Hide annotations" : "Show annotations"}
                          active={showAnnotations}
                          activeColor={ACCENT.yellow}
                          className="!p-2"
                        >
                          {showAnnotations ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </CubistIconButton>
                      </div>
                    )}

                    {annotations && annotations.length > 0 && showAnnotations && (
                      <AnnotationOverlay
                        annotations={annotations}
                        colors={result.colors}
                        hoveredIdx={hoveredAnnIndex}
                        onHover={setHoveredAnnIndex}
                        normalize={normalizeCoordinate}
                        fontFamily={result?.fonts?.[0] ? `"${result.fonts[0]}", system-ui, sans-serif` : undefined}
                      />
                    )}

                    {/* Twist overlay */}
                    <AnimatePresence>
                      {result?.twist?.hasTwist && !activeImage.dismissedTwist && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          transition={{ delay: 0.5, type: 'spring', damping: 20 }}
                          className="absolute bottom-3 left-3 right-3 z-40 bg-[#fbd743] border-[4px] border-[#111111] shadow-[4px_4px_0px_0px_#111111] rounded-xl p-4 flex gap-3 items-start"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex-1">
                            <div className="text-[#111111] text-xs font-black uppercase tracking-wider mb-1 flex justify-between items-center">
                              <span>Aesthetic Twist</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); updateActiveImage({ dismissedTwist: true }); }}
                                className="text-[#111111]/60 hover:text-[#111111] transition-colors p-1 -mt-1 -mr-1 rounded-full hover:bg-black/10"
                                aria-label="Dismiss twist"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-[#111111] text-sm leading-relaxed font-medium">{result.twist.description}</div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="mt-3 text-center font-bold uppercase text-[#111111] opacity-60 text-xs sm:text-sm tracking-wider">
                    Click image to view full screen
                  </div>
                </motion.div>

                <div className="w-full flex flex-col gap-3">
                  <CubistButton
                    onClick={annotateImage}
                    disabled={isAnnotating || !!annotations}
                    color={annotations ? ACCENT.mint : undefined}
                    variant={annotations ? 'solid' : 'ghost'}
                    className="w-full"
                  >
                    {isAnnotating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Decoding aesthetic...
                      </>
                    ) : annotations ? (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Aesthetic Decoded
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4" />
                        Decode Precisely
                      </>
                    )}
                  </CubistButton>
                  <button
                    onClick={reset}
                    className="w-full py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-transparent hover:bg-[#111111]/5 text-[#111111]/60 hover:text-[#111111]"
                  >
                    Remove this image
                  </button>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full p-4 bg-white border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] rounded-xl text-[#111111] text-sm font-bold"
                    style={{ backgroundColor: `${ACCENT.coral}30` }}
                  >
                    {error}
                  </motion.div>
                )}
              </div>

              {/* RIGHT COLUMN */}
              <div className="flex flex-col gap-8 w-full lg:w-1/4">
                <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
                  <CubistCard thick className="p-6">
                    <h3 className="font-black text-xl uppercase tracking-widest mb-4 border-b-[3px] border-[#111111] inline-block self-start">Style Tags</h3>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {Array.isArray(result.styleDetails) && result.styleDetails.map((tag, index) => (
                        <CubistChip key={index}>{tag}</CubistChip>
                      ))}
                    </div>
                    {result.continents && result.continents.length > 0 && (
                      <>
                        <h4 className="text-[#111111]/50 text-xs font-black uppercase tracking-wider mt-5 mb-2">Continent Influence Spotted</h4>
                        <div className="flex flex-wrap gap-2">
                          {result.continents.map((continent, index) => (
                            <CubistChip key={index}>{continent}</CubistChip>
                          ))}
                        </div>
                      </>
                    )}
                  </CubistCard>
                </motion.div>

                <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
                  <CubistCard thick className="p-6 flex flex-col justify-center">
                    <h3 className="font-black text-xl uppercase tracking-widest mb-4 border-b-[3px] border-[#111111] inline-block self-start">
                      {images.filter(img => img.result === result).length > 1 ? 'Collection Check' : 'Explore'}
                    </h3>
                    {images.filter(img => img.result === result).length > 1 ? (
                      !mismatch ? (
                        <CubistButton onClick={findMismatches} disabled={loadingMismatch} color={ACCENT.coral} className="w-full">
                          {loadingMismatch ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
                          Find Mismatches
                        </CubistButton>
                      ) : (
                        <div
                          className="p-4 rounded-xl border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111]"
                          style={{ backgroundColor: isMismatchClean ? `${ACCENT.mint}50` : `${ACCENT.coral}30` }}
                        >
                          <h4 className="text-sm font-black uppercase tracking-wider mb-2 flex items-center gap-2">
                            {isMismatchClean ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                            Mismatch
                          </h4>
                          <p className="text-[#111111] text-sm leading-relaxed whitespace-pre-wrap font-medium">{mismatch}</p>
                        </div>
                      )
                    ) : (
                      <>
                        <p className="font-medium text-base leading-snug mb-4 text-[#111111]/70">
                          Discover more matching this visual signature.
                        </p>
                        <CubistButton
                          onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(result.aesthetic + ' ' + result.styleDetails.join(' '))}`, '_blank')}
                          color={ACCENT.yellow}
                          className="w-full"
                        >
                          Search Google
                          <ExternalLink className="w-4 h-4" />
                        </CubistButton>
                      </>
                    )}
                  </CubistCard>
                </motion.div>
              </div>
            </div>

            {/* Two categories, facing each other — each keeps its items stacked vertically inside */}
            <div className="w-full flex flex-col lg:flex-row items-start justify-center gap-8">
              <div className="w-full lg:w-1/2">
                <h2 className="text-center font-black text-xl sm:text-2xl uppercase tracking-widest mb-6">Creators, Movies & Novels</h2>
                <div className="w-full flex flex-col gap-6">
                  <CubistCard thick className="p-6">
                    <div className="flex items-center justify-between mb-4 border-b-[3px] border-[#111111] pb-1">
                      <h3 className="font-black text-xl uppercase tracking-widest">Creators</h3>
                      <Palette className="w-5 h-5" />
                    </div>
                    <RecommendationSection
                      title=""
                      emptyLabel="Find Artists & Designers"
                      icon={<Palette className="w-4 h-4" />}
                      color={ACCENT.yellow}
                      items={artists}
                      loading={loadingArtists}
                      onFetch={() => fetchRecommendations('artists')}
                      onMore={() => fetchRecommendations('artists', true)}
                      renderLink={(item) => (
                        <HoverPreviewLink
                          href={`https://www.google.com/search?q=${encodeURIComponent(item.title + ' ' + item.authorOrDirector)}`}
                          query={`${item.title} ${item.authorOrDirector}`}
                          platform="Google"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Search on Google
                        </HoverPreviewLink>
                      )}
                      subtitlePrefix=""
                      moreLabel="+ More Artists"
                      hideTitle
                    />
                  </CubistCard>

                  <CubistCard thick className="p-6">
                    <div className="flex items-center justify-between mb-4 border-b-[3px] border-[#111111] pb-1">
                      <h3 className="font-black text-xl uppercase tracking-widest">Movies & Series</h3>
                      <Film className="w-5 h-5" />
                    </div>
                    <RecommendationSection
                      title=""
                      emptyLabel="Find Movies & Series"
                      icon={<Film className="w-4 h-4" />}
                      color={ACCENT.coral}
                      items={movies}
                      loading={loadingMovies}
                      onFetch={() => fetchRecommendations('movies')}
                      onMore={() => fetchRecommendations('movies', true)}
                      renderLink={(item) => (
                        <HoverPreviewLink
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(item.title + ' trailer')}`}
                          query={`${item.title} trailer`}
                          platform="YouTube"
                        >
                          <Youtube className="w-3.5 h-3.5" /> Watch Trailer
                        </HoverPreviewLink>
                      )}
                      subtitlePrefix="by "
                      moreLabel="+ More Movies"
                      posterAspect
                      hideTitle
                    />
                  </CubistCard>

                  <CubistCard thick className="p-6">
                    <div className="flex items-center justify-between mb-4 border-b-[3px] border-[#111111] pb-1">
                      <h3 className="font-black text-xl uppercase tracking-widest">Novels</h3>
                      <Book className="w-5 h-5" />
                    </div>
                    <RecommendationSection
                      title=""
                      emptyLabel="Find Novels & Books"
                      icon={<Book className="w-4 h-4" />}
                      color={ACCENT.blue}
                      items={novels}
                      loading={loadingNovels}
                      onFetch={() => fetchRecommendations('novels')}
                      onMore={() => fetchRecommendations('novels', true)}
                      renderLink={(item) => (
                        <HoverPreviewLink
                          href={`https://www.google.com/search?q=${encodeURIComponent(item.title + ' ' + item.authorOrDirector + ' book')}`}
                          query={`${item.title} ${item.authorOrDirector} book`}
                          platform="Google"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Search on Google
                        </HoverPreviewLink>
                      )}
                      subtitlePrefix="by "
                      moreLabel="+ More Novels"
                      posterAspect
                      hideTitle
                    />
                  </CubistCard>
                </div>
              </div>

              <div className="w-full lg:w-1/2">
                <h2 className="text-center font-black text-xl sm:text-2xl uppercase tracking-widest mb-6">YouTube, Wikipedia & Reddit</h2>
                <div className="w-full flex flex-col gap-6">
                  <QuerySection
                    title="Explore on YouTube"
                    icon={<Youtube className="w-5 h-5" />}
                    accent={ACCENT.coral}
                    categories={result.searchCategories}
                    platformKey="youtubeQueries"
                    baseUrl="https://www.youtube.com/results?search_query="
                    context={result}
                  />
                  <QuerySection
                    title="Read on Wikipedia"
                    icon={<BookOpen className="w-5 h-5" />}
                    accent={ACCENT.blue}
                    categories={result.searchCategories}
                    platformKey="wikipediaQueries"
                    baseUrl="https://en.wikipedia.org/w/index.php?search="
                    context={result}
                  />
                  <QuerySection
                    title="Discuss on Reddit"
                    icon={<MessageSquare className="w-5 h-5" />}
                    accent={ACCENT.yellow}
                    categories={result.searchCategories}
                    platformKey="redditQueries"
                    baseUrl="https://www.reddit.com/search/?q="
                    context={result}
                  />
                </div>
              </div>
            </div>
          </motion.main>
        )}

        {/* Full screen modal for image with annotations */}
        <AnimatePresence>
          {isImageModalOpen && previewUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111111]/85 p-4 md:p-10"
              onClick={() => setIsImageModalOpen(false)}
            >
              <CubistIconButton
                onClick={(e) => { e.stopPropagation(); setIsImageModalOpen(false); }}
                className="!absolute top-6 right-6 z-[110]"
                activeColor={ACCENT.yellow}
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </CubistIconButton>

              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="relative max-h-[85vh] max-w-full rounded-2xl border-[6px] border-[#111111] shadow-[8px_8px_0px_0px_#111111] mx-auto w-fit bg-white flex flex-col justify-center overflow-visible"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative inline-block max-w-full self-center">
                  <img
                    src={previewUrl}
                    alt="Full view"
                    className="max-w-full max-h-[85vh] block"
                  />

                  {annotations && annotations.length > 0 && (
                    <div className="absolute top-4 left-4 z-[60]">
                      <CubistIconButton
                        onClick={(e) => { e.stopPropagation(); setShowAnnotations(prev => !prev); }}
                        title={showAnnotations ? "Hide annotations" : "Show annotations"}
                        active={showAnnotations}
                        activeColor={ACCENT.yellow}
                      >
                        {showAnnotations ? <Eye className="w-6 h-6" /> : <EyeOff className="w-6 h-6" />}
                      </CubistIconButton>
                    </div>
                  )}

                  {annotations && annotations.length > 0 && showAnnotations && (
                    <AnnotationOverlay
                      annotations={annotations}
                      colors={result.colors}
                      hoveredIdx={hoveredAnnIndex}
                      onHover={setHoveredAnnIndex}
                      normalize={normalizeCoordinate}
                      fontFamily={result?.fonts?.[0] ? `"${result.fonts[0]}", system-ui, sans-serif` : undefined}
                      size="lg"
                    />
                  )}

                  <AnimatePresence>
                    {result?.twist?.hasTwist && !activeImage.dismissedTwist && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ delay: 0.5, type: 'spring', damping: 20 }}
                        className="absolute bottom-4 left-4 right-4 z-50 bg-[#fbd743] border-[4px] border-[#111111] shadow-[5px_5px_0px_0px_#111111] rounded-2xl p-5 flex gap-4 items-start"
                      >
                        <div className="flex-1">
                          <div className="text-[#111111] text-sm font-black uppercase tracking-wider mb-1 flex justify-between items-center">
                            <span>Aesthetic Twist</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); updateActiveImage({ dismissedTwist: true }); }}
                              className="text-[#111111]/60 hover:text-[#111111] transition-colors p-1.5 -mt-1.5 -mr-1.5 rounded-full hover:bg-black/10"
                              aria-label="Dismiss twist"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="text-[#111111] text-base leading-relaxed font-medium">{result.twist.description}</div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Shared layout for the Artists / Movies / Novels recommendation blocks. */
function RecommendationSection<T extends Recommendation>({
  title,
  emptyLabel,
  icon,
  color,
  items,
  loading,
  onFetch,
  onMore,
  renderLink,
  subtitlePrefix,
  moreLabel,
  posterAspect,
  hideTitle,
}: {
  title: string;
  emptyLabel: string;
  icon: React.ReactNode;
  color: string;
  items: T[] | null;
  loading: boolean;
  onFetch: () => void;
  onMore: () => void;
  renderLink: (item: T) => React.ReactNode;
  subtitlePrefix: string;
  moreLabel: string;
  posterAspect?: boolean;
  hideTitle?: boolean;
}) {
  if (!items) {
    return (
      <CubistButton onClick={onFetch} disabled={loading} color={color} className="w-full !text-sm">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
        {emptyLabel}
      </CubistButton>
    );
  }

  return (
    <div className="space-y-3">
      {!hideTitle && (
        <h4 className="flex items-center gap-2 text-xs font-black text-[#111111]/50 uppercase tracking-wider mb-1 font-sans">
          {icon} {title}
        </h4>
      )}
      {items.map((item, idx) => (
        <motion.div
          key={idx}
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.99 }}
          className="bg-white p-3 rounded-xl border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] flex flex-row gap-3"
        >
          {item.imageUrl && (
            <div className={`${posterAspect ? 'w-16 h-24 sm:w-20 sm:h-28' : 'w-20 h-20'} shrink-0 border-[3px] border-[#111111] rounded-lg overflow-hidden relative bg-[#fef8f0]`}>
              <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h5 className="font-black text-sm">{item.title}</h5>
            <p className="text-xs text-[#111111]/50 mb-2 font-bold">{subtitlePrefix}{item.authorOrDirector}</p>
            <p className="text-xs text-[#111111]/80 leading-relaxed mb-2 font-medium">{item.reason}</p>
            {renderLink(item)}
          </div>
        </motion.div>
      ))}
      <CubistButton onClick={onMore} disabled={loading} variant="ghost" className="w-full !py-2 !text-sm">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{moreLabel}</span>}
      </CubistButton>
    </div>
  );
}

const FontHoverPreview: React.FC<{ font: string, text: string, color: string | null }> = ({ font, text, color }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      whileHover={{ scale: 1.01, y: -2 }}
      className={`relative flex items-center justify-between px-3 py-2.5 bg-white border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] rounded-xl group ${isHovered ? 'z-50' : 'z-10'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}&display=swap');` }} />
      <span className="text-xs font-bold text-[#111111]/60 group-hover:text-[#111111] transition-colors cursor-default font-sans truncate max-w-[40%]">
        {font}
      </span>
      <span
        className="text-lg cursor-default text-right whitespace-nowrap overflow-hidden text-ellipsis max-w-[58%]"
        style={{ fontFamily: `"${font}", system-ui, sans-serif`, color: color || '#111111' }}
      >
        {text || font}
      </span>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-3 w-[280px] p-5 bg-white border-[4px] border-[#111111] shadow-[5px_5px_0px_0px_#111111] rounded-2xl overflow-hidden pointer-events-none"
          >
            <div className="relative z-10">
              <div
                className="text-4xl mb-2"
                style={{ fontFamily: `"${font}", system-ui, sans-serif`, color: color || '#111111' }}
              >
                Aa Bb Cc
              </div>
              <div
                className="text-lg opacity-80 font-medium"
                style={{ fontFamily: `"${font}", system-ui, sans-serif`, color: color || '#111111' }}
              >
                {text || "The quick brown fox jumps over the lazy dog."}
              </div>
            </div>
            <div
              className="absolute -right-4 -bottom-6 text-[8rem] leading-none text-[#111111]/[0.06] select-none pointer-events-none"
              style={{ fontFamily: `"${font}", system-ui, sans-serif` }}
            >
              Ag
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const HoverPreviewLink: React.FC<{ href: string; children: React.ReactNode; query: string; platform: string; className?: string }> = ({ href, children, className }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      className={`relative group/link inline-flex ${isHovered ? 'z-50' : 'z-10'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#111111]/70 hover:text-[#111111] transition-colors border-b-2 border-[#111111]/30 hover:border-[#111111] pb-0.5 ${className || ''}`}
      >
        {children}
      </a>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-3 w-[400px] h-[300px] bg-white border-[4px] border-[#111111] shadow-[6px_6px_0px_0px_#111111] rounded-2xl overflow-hidden pointer-events-none"
          >
            <div className="w-full h-full bg-[#fef8f0] flex items-center justify-center relative">
              <iframe
                src={href}
                className="w-full h-full border-0 absolute top-0 left-0 bg-white"
                title="Search Preview"
                sandbox="allow-same-origin allow-scripts"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function QuerySection({ title, icon, accent, categories, platformKey, baseUrl, context, className }: { title: string, icon: React.ReactNode, accent: string, categories: SearchCategory[], platformKey: 'youtubeQueries' | 'wikipediaQueries' | 'redditQueries', baseUrl: string, context?: AnalysisResult, className?: string }) {
  const [extraCategories, setExtraCategories] = useState<{ categoryName: string, queries: string[] }[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  if (!categories || categories.length === 0) return null;
  const platform = title.replace('Explore on ', '').replace('Read on ', '').replace('Discuss on ', '');

  const mergedCategoriesMap = new Map<string, string[]>();

  categories.forEach(c => {
    const qs = c[platformKey];
    if (qs && qs.length > 0) {
      mergedCategoriesMap.set(c.categoryName, [...qs]);
    }
  });

  extraCategories.forEach(c => {
    if (mergedCategoriesMap.has(c.categoryName)) {
      const existing = mergedCategoriesMap.get(c.categoryName)!;
      mergedCategoriesMap.set(c.categoryName, Array.from(new Set([...existing, ...c.queries])));
    } else {
      mergedCategoriesMap.set(c.categoryName, [...c.queries]);
    }
  });

  const mergedCategoriesList = Array.from(mergedCategoriesMap.entries()).map(([categoryName, queries]) => ({ categoryName, queries }));
  const allQueries = mergedCategoriesList.flatMap(c => c.queries);

  const handleLoadMore = async () => {
    if (!context) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch('/api/more-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, context, existingQueries: allQueries }),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setExtraCategories(prev => [...prev, ...data]);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <CubistCard thick className={`p-5 sm:p-6 space-y-5 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div
          className="p-2 rounded-lg border-[3px] border-[#111111] shadow-[2px_2px_0px_0px_#111111]"
          style={{ backgroundColor: accent }}
        >
          {icon}
        </div>
        <h3 className="text-lg font-black uppercase tracking-wide">{title}</h3>
      </div>

      {mergedCategoriesList.map((category, idx) => (
        <div key={idx} className="space-y-2">
          <h4 className="text-xs font-black text-[#111111]/50 uppercase tracking-wider pl-1 font-sans">{category.categoryName}</h4>
          <QueryList queries={category.queries} platform={platform} baseUrl={baseUrl} accent={accent} />
        </div>
      ))}

      {context && (
        <div className="pt-1">
          <CubistButton onClick={handleLoadMore} disabled={isLoadingMore} variant="ghost" className="w-full !py-2 !px-4 !text-sm">
            {isLoadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>+ More {platform} queries</span>}
          </CubistButton>
        </div>
      )}
    </CubistCard>
  );
}

function QueryList({ queries, platform, baseUrl, accent }: { queries: string[], platform: string, baseUrl: string, accent: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {queries.map((query, index) => (
        <motion.a
          key={index}
          href={`${baseUrl}${encodeURIComponent(query)}`}
          target="_blank"
          rel="noopener noreferrer"
          whileHover={{ y: -2, backgroundColor: accent }}
          whileTap={{ scale: 0.97 }}
          className="px-3.5 py-2 bg-white border-[3px] border-[#111111] shadow-[2px_2px_0px_0px_#111111] rounded-xl text-xs sm:text-sm font-bold text-[#111111] transition-colors"
        >
          {query}
        </motion.a>
      ))}
    </div>
  );
}

/** Numbered pins drawn on top of the image — no text, so nothing ever overlaps the photo. */
/**
 * Annotation pins + outward-pointing arrow, matching the original Aesthetic Explorer style:
 * a plain colored dot on the image, and on hover a line running to the nearest edge with the
 * comment shown in a small card just outside the photo (never overlapping it).
 */
function AnnotationOverlay({
  annotations,
  colors,
  hoveredIdx,
  onHover,
  normalize,
  fontFamily,
  size = 'md',
}: {
  annotations: { x: number; y: number; comment: string }[];
  colors?: string[];
  hoveredIdx: number | null;
  onHover: (idx: number | null) => void;
  normalize: (v: number) => number;
  fontFamily?: string;
  size?: 'md' | 'lg';
}) {
  const pinDims = size === 'lg' ? 'w-6 h-6 md:w-7 md:h-7' : 'w-5 h-5 md:w-6 md:h-6';
  const boxWidth = size === 'lg' ? 'w-64 md:w-80' : 'w-40 md:w-48';
  const boxText = size === 'lg' ? 'text-sm md:text-base px-4 py-3' : 'text-xs px-3 py-2';
  const gapPx = size === 'lg' ? 20 : 16;
  const gap = `${gapPx}px`;

  return (
    <>
      <AnimatePresence>
        {annotations.map((ann, idx) => {
          const pinColor = colors?.[idx % (colors.length || 1)] || '#fbd743';
          const isActive = hoveredIdx === idx;
          return (
            <motion.div
              key={`pin-${idx}`}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ delay: idx * 0.08, type: 'spring', stiffness: 300, damping: 20 }}
              className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${normalize(ann.x)}%`, top: `${normalize(ann.y)}%` }}
              onMouseEnter={() => onHover(idx)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`rounded-full border-[3px] border-[#111111] shadow-[2px_2px_0px_0px_#111111] cursor-pointer transition-transform ${pinDims}`}
                style={{ backgroundColor: pinColor, transform: isActive ? 'scale(1.25)' : 'scale(1)' }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>

      <AnimatePresence>
        {annotations.map((ann, idx) => {
          if (hoveredIdx !== idx) return null;
          const pinColor = colors?.[idx % (colors.length || 1)] || '#fbd743';
          const normX = normalize(ann.x);
          const normY = normalize(ann.y);
          const isRightHalf = normX > 50;
          const targetX = isRightHalf ? 100 : 0;

          return (
            <motion.div
              key={`ann-overlay-${idx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 pointer-events-none"
            >
              <svg className="w-full h-full overflow-visible pointer-events-none relative z-50">
                <line x1={`${normX}%`} y1={`${normY}%`} x2={`${targetX}%`} y2={`${normY}%`} stroke="#111111" strokeWidth="2.5" />
                <circle cx={`${targetX}%`} cy={`${normY}%`} r="4" fill={pinColor} stroke="#111111" strokeWidth="1.5" />
              </svg>

              {/* Pixel-precise connector: bridges the gap between the image edge and the tooltip box so the line actually touches it */}
              <div
                className="absolute h-[2.5px] bg-[#111111]"
                style={{
                  top: `${normY}%`,
                  [isRightHalf ? 'left' : 'right']: '100%',
                  width: gap,
                  transform: 'translateY(-50%)',
                }}
              />

              <div
                className="absolute pointer-events-auto"
                style={{
                  left: `${targetX}%`,
                  top: `${normY}%`,
                  transform: `translate(${isRightHalf ? gap : `calc(-100% - ${gap})`}, -50%)`,
                }}
                onMouseEnter={() => onHover(idx)}
                onMouseLeave={() => onHover(null)}
              >
                <div
                  className={`bg-white border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] text-[#111111] font-bold rounded-xl leading-relaxed ${boxWidth} ${boxText}`}
                  style={{ fontFamily }}
                >
                  {ann.comment}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </>
  );
}
