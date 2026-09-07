import { useEffect, useRef, useState } from 'react';

export function useAdaptiveAudio(result: any) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Nodes
  const osc1Ref = useRef<OscillatorNode | null>(null);
  const osc2Ref = useRef<OscillatorNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;

    // Create nodes
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc1Ref.current = osc1;
    osc2Ref.current = osc2;
    lfoRef.current = lfo;
    filterRef.current = filter;
    gainRef.current = gain;

    // Base settings (will be updated by aesthetic)
    osc1.type = 'sawtooth';
    osc2.type = 'sine';
    lfo.type = 'sine';
    
    // Default routing
    osc1.connect(filter);
    osc2.connect(filter);
    
    // LFO to filter frequency
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    filter.connect(gain);
    gain.connect(ctx.destination);
    
    // Start nodes
    osc1.start();
    osc2.start();
    lfo.start();
    
    // Fade in
    gain.gain.setValueAtTime(0, ctx.currentTime);
  };

  const updateSynthParameters = () => {
    if (!audioCtxRef.current || !filterRef.current || !osc1Ref.current || !osc2Ref.current || !lfoRef.current || !gainRef.current) return;
    
    const ctx = audioCtxRef.current;
    const filter = filterRef.current;
    const osc1 = osc1Ref.current;
    const osc2 = osc2Ref.current;
    const lfo = lfoRef.current;
    
    const moods = result?.mood || [];
    const tags = result?.styleDetails || [];
    const textBlob = [...moods, ...tags].join(' ').toLowerCase();

    // Analyze text for aesthetic vibe
    const isEthereal = textBlob.includes('ethereal') || textBlob.includes('dream') || textBlob.includes('light');
    const isMysterious = textBlob.includes('mystery') || textBlob.includes('mysterious') || textBlob.includes('awe') || textBlob.includes('dark');
    const isAbsurd = textBlob.includes('absurd') || textBlob.includes('playful') || textBlob.includes('weird') || textBlob.includes('alien');
    
    let baseFreq = 65.41; // C2
    if (isEthereal) baseFreq = 130.81; // C3
    if (isMysterious) baseFreq = 43.65; // F1 Sub bass
    
    let filterFreq = 800;
    if (isEthereal) filterFreq = 2000;
    if (isMysterious) filterFreq = 400;

    let lfoRate = 0.1; // slow sweep
    if (isAbsurd) lfoRate = 3.5; // jittery/wobble
    if (isEthereal) lfoRate = 0.05;

    // Smooth transition to new values
    const now = ctx.currentTime;
    osc1.frequency.setTargetAtTime(baseFreq, now, 2);
    // Detune osc2 slightly for width, maybe a fifth or octave
    osc2.frequency.setTargetAtTime(isAbsurd ? baseFreq * 1.5 : baseFreq * 0.5, now, 2);
    
    // Absurd: use strange waveforms
    osc1.type = isAbsurd ? 'square' : isEthereal ? 'triangle' : 'sawtooth';
    osc2.type = isAbsurd ? 'triangle' : 'sine';
    
    filter.frequency.setTargetAtTime(filterFreq, now, 2);
    filter.Q.setTargetAtTime(isMysterious ? 5 : 2, now, 2);
    lfo.frequency.setTargetAtTime(lfoRate, now, 2);
  };

  useEffect(() => {
    if (isPlaying && result) {
      updateSynthParameters();
    }
  }, [result, isPlaying]);

  const togglePlay = () => {
    if (!isPlaying) {
      if (!audioCtxRef.current) {
        initAudio();
      }
      
      const ctx = audioCtxRef.current;
      const gain = gainRef.current;
      if (ctx && gain) {
        if (ctx.state === 'suspended') ctx.resume();
        // Fade in
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 3);
      }
      setIsPlaying(true);
      setTimeout(updateSynthParameters, 50); // slight delay to ensure nodes are ready
    } else {
      const ctx = audioCtxRef.current;
      const gain = gainRef.current;
      if (ctx && gain) {
        // Fade out
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
        
        setTimeout(() => {
          if (ctx.state === 'running') ctx.suspend();
        }, 2100);
      }
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return { isPlaying, togglePlay };
}
