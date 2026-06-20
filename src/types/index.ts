export interface Position {
  id: string;
  marketName: string;
  outcome: string;
  shares: number;
  averagePrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPercentage: number;
}

export interface Account {
  id: string;
  address: string;
  username?: string;
  totalVolume: number;
  profitability: number;
  totalPnL: number;
  winRate: number | null;
  lastActive: string;
  openPositions: Position[];
}

export type TabType = 'all' | 'following' | 'top';
export type SortType = 'profit' | 'volume';
