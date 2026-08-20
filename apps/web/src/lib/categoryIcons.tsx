import React from "react";
import {
  Wallet,
  ShoppingCart,
  ShoppingBag,
  Home,
  Car,
  Film,
  Utensils,
  Repeat,
  Activity,
  Heart,
  Sofa,
  Smartphone,
  Laptop,
  Plane,
  Gift,
  GraduationCap,
  Dumbbell,
  Dog,
  Shirt,
  Fuel,
  Coffee,
  Wrench,
  Briefcase,
  Ticket,
  Folder,
  DollarSign,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Pizza,
  Zap,
  BookOpen,
  Baby,
  Gamepad2,
  Tv,
  Music,
  Smile,
  Pill,
  Bus,
  Train,
  Bike,
  Sparkles,
  Shield,
  Package,
  MoreHorizontal,
  LucideIcon,
} from "lucide-react";

export type IconComponent = React.FC<React.SVGProps<SVGSVGElement>>;

export interface CategoryIconDefinition {
  label: string;
  synonyms: string[];
  icon: LucideIcon;
}

export const CATEGORY_ICONS: Record<string, CategoryIconDefinition> = {
  wallet: {
    label: "Carteira / Renda",
    synonyms: ["renda", "salário", "dinheiro", "carteira", "banco", "receita", "ganhos"],
    icon: Wallet,
  },
  cart: {
    label: "Mercado",
    synonyms: ["mercado", "supermercado", "compras", "feira", "carrinho", "mantimentos"],
    icon: ShoppingCart,
  },
  shopping_bag: {
    label: "Compras & Lojas",
    synonyms: ["compras", "shopping", "loja", "varejo", "produtos"],
    icon: ShoppingBag,
  },
  home: {
    label: "Moradia",
    synonyms: ["casa", "moradia", "aluguel", "condomínio", "iptu", "lar"],
    icon: Home,
  },
  car: {
    label: "Carro & Veículo",
    synonyms: ["carro", "transporte", "uber", "veículo", "automóvel"],
    icon: Car,
  },
  fuel: {
    label: "Combustível",
    synonyms: ["combustível", "gasolina", "etanol", "posto", "abastecer"],
    icon: Fuel,
  },
  bus: {
    label: "Transporte Público",
    synonyms: ["ônibus", "transporte", "passagem", "metrô", "condução"],
    icon: Bus,
  },
  bike: {
    label: "Bicicleta",
    synonyms: ["bike", "bicicleta", "ciclismo", "pedal"],
    icon: Bike,
  },
  plane: {
    label: "Viagem & Férias",
    synonyms: ["viagem", "voo", "férias", "hotel", "passagem", "turismo"],
    icon: Plane,
  },
  utensils: {
    label: "Restaurante",
    synonyms: ["comida", "restaurante", "almoço", "jantar", "delivery", "ifood", "lanche", "alimentação"],
    icon: Utensils,
  },
  coffee: {
    label: "Café & Padaria",
    synonyms: ["café", "cafeteria", "lanche", "padaria", "bebida", "starbucks"],
    icon: Coffee,
  },
  pizza: {
    label: "Fast Food & Pizza",
    synonyms: ["pizza", "hambúrguer", "lanche", "fastfood", "ifood"],
    icon: Pizza,
  },
  film: {
    label: "Cinema & Filmes",
    synonyms: ["lazer", "cinema", "streaming", "netflix", "filme", "filmes"],
    icon: Film,
  },
  tv: {
    label: "TV & Streaming",
    synonyms: ["tv", "televisão", "streaming", "séries", "canais"],
    icon: Tv,
  },
  music: {
    label: "Música & Áudio",
    synonyms: ["música", "shows", "spotify", "concerto", "som"],
    icon: Music,
  },
  gamepad: {
    label: "Jogos & Games",
    synonyms: ["jogos", "games", "videogame", "steam", "playstation", "xbox"],
    icon: Gamepad2,
  },
  ticket: {
    label: "Eventos & Shows",
    synonyms: ["show", "evento", "ingresso", "teatro", "festa"],
    icon: Ticket,
  },
  repeat: {
    label: "Serviços & Recorrentes",
    synonyms: ["serviços", "recorrente", "mensalidade", "planos"],
    icon: Repeat,
  },
  pulse: {
    label: "Saúde & Médicos",
    synonyms: ["saúde", "médico", "hospital", "exame", "consulta", "plano de saúde"],
    icon: Activity,
  },
  pill: {
    label: "Farmácia & Remédios",
    synonyms: ["farmácia", "remédio", "medicamento", "drogaria"],
    icon: Pill,
  },
  heart: {
    label: "Cuidados & Doações",
    synonyms: ["doação", "amor", "caridade", "cuidados", "voluntariado"],
    icon: Heart,
  },
  dumbbell: {
    label: "Academia & Treino",
    synonyms: ["academia", "treino", "esporte", "fitness", "exercício", "crossfit"],
    icon: Dumbbell,
  },
  smile: {
    label: "Beleza & Estética",
    synonyms: ["beleza", "cabelo", "barbearia", "estética", "salão", "spa"],
    icon: Smile,
  },
  sofa: {
    label: "Casa & Móveis",
    synonyms: ["casa", "móveis", "decoração", "sofá", "reforma", "conforto"],
    icon: Sofa,
  },
  tools: {
    label: "Manutenção & Obras",
    synonyms: ["ferramentas", "manutenção", "reforma", "conserto", "obra"],
    icon: Wrench,
  },
  zap: {
    label: "Energia & Utilidades",
    synonyms: ["luz", "energia", "eletricidade", "água", "gás", "contas"],
    icon: Zap,
  },
  device: {
    label: "Celular & Eletrônicos",
    synonyms: ["celular", "smartphone", "computador", "tecnologia", "eletrônicos", "gadgets"],
    icon: Smartphone,
  },
  laptop: {
    label: "Computador & TI",
    synonyms: ["computador", "notebook", "laptop", "software", "hardware"],
    icon: Laptop,
  },
  book: {
    label: "Educação & Cursos",
    synonyms: ["educação", "curso", "faculdade", "livro", "escola", "estudos", "formatura"],
    icon: GraduationCap,
  },
  book_open: {
    label: "Livros & Leitura",
    synonyms: ["livros", "leitura", "biblioteca", "revista"],
    icon: BookOpen,
  },
  briefcase: {
    label: "Trabalho & Negócios",
    synonyms: ["trabalho", "negócios", "empresa", "freelance", "escritório"],
    icon: Briefcase,
  },
  dollar: {
    label: "Investimentos",
    synonyms: ["dinheiro", "investimentos", "ações", "rendimento", "cripto"],
    icon: DollarSign,
  },
  piggy: {
    label: "Poupança & Cofrinho",
    synonyms: ["poupança", "cofrinho", "economia", "reserva"],
    icon: PiggyBank,
  },
  trending: {
    label: "Crescimento & Renda",
    synonyms: ["rendimentos", "lucro", "alta", "crescimento"],
    icon: TrendingUp,
  },
  card: {
    label: "Cartão de Crédito",
    synonyms: ["cartão", "fatura", "crédito", "débito"],
    icon: CreditCard,
  },
  gift: {
    label: "Presentes & Festas",
    synonyms: ["presente", "aniversário", "doação", "festa", "natal"],
    icon: Gift,
  },
  shirt: {
    label: "Roupas & Moda",
    synonyms: ["roupas", "vestuário", "calçado", "moda", "compras", "tênis"],
    icon: Shirt,
  },
  paw: {
    label: "Pets & Animais",
    synonyms: ["pet", "cachorro", "gato", "veterinário", "ração", "animais"],
    icon: Dog,
  },
  baby: {
    label: "Bebê & Crianças",
    synonyms: ["bebê", "criança", "filhos", "fralda", "brinquedos"],
    icon: Baby,
  },
  shield: {
    label: "Seguros & Proteção",
    synonyms: ["seguro", "proteção", "garantia", "apólice"],
    icon: Shield,
  },
  package: {
    label: "Entregas & Correios",
    synonyms: ["encomenda", "correios", "entrega", "pacote"],
    icon: Package,
  },
  sparkles: {
    label: "Especial & Serviços",
    synonyms: ["especial", "serviço", "destaque", "experiência"],
    icon: Sparkles,
  },
  dots: {
    label: "Outros & Diversos",
    synonyms: ["outros", "diversos", "geral", "variados", "extra"],
    icon: MoreHorizontal,
  },
  folder: {
    label: "Geral",
    synonyms: ["geral", "pasta", "categoria"],
    icon: Folder,
  },
};

export const ICON_KEYS = Object.keys(CATEGORY_ICONS).filter((k) => k !== "folder");

export function getCategoryIconComponent(iconKey?: string | null): IconComponent {
  if (!iconKey) return CATEGORY_ICONS.folder.icon as any;
  const normalized = iconKey.toLowerCase().trim();
  const match = CATEGORY_ICONS[normalized];
  if (match) return match.icon as any;

  // Fallbacks para nomes de ícones comuns ou legados
  if (normalized === "pulse" || normalized === "activity") return Activity as any;
  if (normalized === "device" || normalized === "phone") return Smartphone as any;
  if (normalized === "tools" || normalized === "wrench") return Wrench as any;
  if (normalized === "paw" || normalized === "dog") return Dog as any;
  if (normalized === "dots" || normalized === "more") return MoreHorizontal as any;
  if (normalized === "dollar" || normalized === "money") return DollarSign as any;
  if (normalized === "book" || normalized === "graduation") return GraduationCap as any;

  return CATEGORY_ICONS.folder.icon as any;
}

export function searchIcons(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return ICON_KEYS;

  return ICON_KEYS.filter((key) => {
    const item = CATEGORY_ICONS[key];
    if (key.includes(q) || item.label.toLowerCase().includes(q)) return true;
    return item.synonyms.some((s) => s.includes(q));
  });
}

