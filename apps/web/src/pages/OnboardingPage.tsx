import React, { useState, useEffect } from "react";
import { Logo } from "../components/icons/Logo";
import { Button } from "../components/ui/Button";

interface OnboardingPageProps {
  onFinish: () => void;
}

const SLIDES = [
  {
    title: "Tudo o que entra e sai, num só lugar.",
    description:
      "Conecte suas contas e cartões bancários e veja o quadro completo da sua vida financeira, atualizado todos os dias.",
  },
  {
    title: "Orçamentos e metas de economia.",
    description:
      "Acompanhe seus gastos por categoria com alertas proativos e planeje o ritmo ideal para realizar seus objetivos.",
  },
  {
    title: "Relatórios e visão financeira.",
    description:
      "Acompanhe relatórios detalhados da evolução dos seus gastos por categoria e fluxo de caixa ao longo do tempo.",
  },
];

export function OnboardingPage({ onFinish }: OnboardingPageProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  function handleNext() {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide((prev) => prev + 1);
    } else {
      onFinish();
    }
  }

  function handlePrev() {
    if (currentSlide > 0) {
      setCurrentSlide((prev) => prev - 1);
    }
  }

  // Navegação por setas do teclado
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlide]);

  const slide = SLIDES[currentSlide];

  return (
    <div className="min-h-dvh grid grid-cols-1 lg:grid-cols-2 bg-bg text-text-primary">
      {/* Coluna Esquerda: Texto e Ações */}
      <div className="flex flex-col justify-between p-8 md:p-16 lg:p-24 max-w-xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <Logo className="w-8 h-8 text-primary" />
          <span className="font-display font-extrabold text-2xl tracking-tight">
            Poup<span className="text-primary">.</span>
          </span>
        </div>

        {/* Slide Content com Crossfade */}
        <div key={currentSlide} className="flex flex-col gap-6 my-12 anim-fade-up">
          <h1 className="font-display font-extrabold text-4xl md:text-5xl leading-[1.12] tracking-tight">
            {slide.title}
          </h1>
          <p className="text-base md:text-lg text-text-secondary leading-relaxed">
            {slide.description}
          </p>

          {/* Dots Indicator Acessível */}
          <div role="tablist" aria-label="Slides de introdução" className="flex items-center gap-2 pt-2">
            {SLIDES.map((_, idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={idx === currentSlide}
                aria-label={`Slide ${idx + 1}`}
                onClick={() => setCurrentSlide(idx)}
                className={`h-2 rounded-full transition-all focus-ring ${
                  idx === currentSlide ? "w-8 bg-primary" : "w-2 bg-border hover:bg-border-strong"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="primary"
            size="lg"
            onClick={handleNext}
          >
            {currentSlide === SLIDES.length - 1 ? "Começar agora" : "Continuar"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={onFinish}
            className="text-text-secondary hover:text-text-primary"
          >
            Pular
          </Button>
        </div>
      </div>

      {/* Coluna Direita: Painel Visual */}
      <div className="hidden lg:flex bg-primary-soft items-center justify-center p-12 relative overflow-hidden">
        <div className="w-80 h-80 rounded-panel bg-surface shadow-sh3 flex items-center justify-center p-12 border border-primary/20 anim-scale-in">
          <Logo className="w-full h-full text-primary" />
        </div>
      </div>
    </div>
  );
}

