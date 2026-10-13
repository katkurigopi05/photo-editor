/**
 * Presenter Mode & Speaker Notes Engine.
 *
 * Implements Canva-style presentation controls:
 * - Slide / Scene navigation with cue points
 * - Speaker notes management
 * - Presentation stopwatch & pacing monitor
 * - Interactive presentation tools: Laser pointer and Spotlight aperture
 * - Full presentation keyboard navigation
 */

export interface PresentationSlide {
  id: string;
  title: string;
  startMicroseconds: bigint;
  durationMicroseconds: bigint;
  speakerNotes: string;
}

export type PointerTool = "normal" | "laser" | "spotlight";

export interface LaserPoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface SpotlightState {
  x: number;
  y: number;
  radius: number;
}

export class PresentationController {
  private slides: PresentationSlide[] = [];
  private activeIndex = 0;
  private pointerTool: PointerTool = "normal";
  private laserTrail: LaserPoint[] = [];
  private spotlight: SpotlightState = { x: 0.5, y: 0.5, radius: 120 };

  // Timer state
  private timerRunning = false;
  private timerStartTime = 0;
  private timerAccumulatedMs = 0;
  private targetDurationSeconds: number | null = null;

  constructor(slides: readonly PresentationSlide[] = []) {
    this.slides = [...slides];
  }

  get slideCount(): number {
    return this.slides.length;
  }

  get currentSlideIndex(): number {
    return this.activeIndex;
  }

  get currentSlide(): PresentationSlide | undefined {
    return this.slides[this.activeIndex];
  }

  get allSlides(): readonly PresentationSlide[] {
    return this.slides;
  }

  setSlides(slides: readonly PresentationSlide[]): void {
    this.slides = [...slides];
    if (this.activeIndex >= this.slides.length) {
      this.activeIndex = Math.max(0, this.slides.length - 1);
    }
  }

  nextSlide(): boolean {
    if (this.activeIndex < this.slides.length - 1) {
      this.activeIndex += 1;
      return true;
    }
    return false;
  }

  prevSlide(): boolean {
    if (this.activeIndex > 0) {
      this.activeIndex -= 1;
      return true;
    }
    return false;
  }

  goToSlide(index: number): boolean {
    if (index >= 0 && index < this.slides.length) {
      this.activeIndex = index;
      return true;
    }
    return false;
  }

  updateSpeakerNotes(slideId: string, notes: string): boolean {
    const slide = this.slides.find((s) => s.id === slideId);
    if (!slide) return false;
    slide.speakerNotes = notes;
    return true;
  }

  // Pointer Tool Controls
  get currentTool(): PointerTool {
    return this.pointerTool;
  }

  setTool(tool: PointerTool): void {
    this.pointerTool = tool;
    if (tool !== "laser") {
      this.laserTrail = [];
    }
  }

  toggleLaser(): PointerTool {
    const nextTool: PointerTool =
      this.pointerTool === "laser" ? "normal" : "laser";
    this.setTool(nextTool);
    return nextTool;
  }

  toggleSpotlight(): PointerTool {
    const nextTool: PointerTool =
      this.pointerTool === "spotlight" ? "normal" : "spotlight";
    this.setTool(nextTool);
    return nextTool;
  }

  updatePointerPosition(x: number, y: number, now = Date.now()): void {
    if (this.pointerTool === "laser") {
      this.laserTrail.push({ x, y, timestamp: now });
      // Keep only recent points (last 1.5 seconds)
      const cutoff = now - 1500;
      this.laserTrail = this.laserTrail.filter((p) => p.timestamp >= cutoff);
    } else if (this.pointerTool === "spotlight") {
      this.spotlight.x = x;
      this.spotlight.y = y;
    }
  }

  getLaserTrail(now = Date.now()): readonly LaserPoint[] {
    const cutoff = now - 1500;
    this.laserTrail = this.laserTrail.filter((p) => p.timestamp >= cutoff);
    return this.laserTrail;
  }

  getSpotlight(): SpotlightState {
    return { ...this.spotlight };
  }

  setSpotlightRadius(radius: number): void {
    this.spotlight.radius = Math.max(30, Math.min(600, radius));
  }

  // Timer & Pacing
  startTimer(targetDurationSeconds?: number): void {
    if (targetDurationSeconds !== undefined) {
      this.targetDurationSeconds = targetDurationSeconds;
    }
    if (!this.timerRunning) {
      this.timerRunning = true;
      this.timerStartTime = Date.now();
    }
  }

  pauseTimer(): void {
    if (this.timerRunning) {
      this.timerAccumulatedMs += Date.now() - this.timerStartTime;
      this.timerRunning = false;
    }
  }

  resetTimer(): void {
    this.timerRunning = false;
    this.timerStartTime = 0;
    this.timerAccumulatedMs = 0;
  }

  getElapsedTimeMs(now = Date.now()): number {
    if (!this.timerRunning) return this.timerAccumulatedMs;
    return this.timerAccumulatedMs + (now - this.timerStartTime);
  }

  isOvertime(now = Date.now()): boolean {
    if (this.targetDurationSeconds === null) return false;
    return this.getElapsedTimeMs(now) > this.targetDurationSeconds * 1000;
  }

  handleKeyDown(key: string): boolean {
    switch (key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        return this.nextSlide();
      case "ArrowLeft":
      case "PageUp":
        return this.prevSlide();
      case "l":
      case "L":
        this.toggleLaser();
        return true;
      case "b":
      case "B":
        this.toggleSpotlight();
        return true;
      case "Escape":
        this.setTool("normal");
        return true;
      default:
        return false;
    }
  }
}
