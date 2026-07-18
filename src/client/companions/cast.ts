import type { CompanionId } from "../../shared/companions";

export type CompanionProfile = {
  id: CompanionId;
  name: string;
  role: string;
  alt: string;
  asset: string;
  accent: string;
};

export const COMPANION_CAST: Record<CompanionId, CompanionProfile> = {
  lumi: {
    id: "lumi",
    name: "별토끼 버니",
    role: "버니 별빛 길 안내자",
    alt: "작은 망토와 별 지팡이를 든 크림색 토끼 버니",
    asset: "/assets/companions/lumi.svg",
    accent: "lilac"
  },
  toto: {
    id: "toto",
    name: "수달 또또",
    role: "국어와 낱말 친구",
    alt: "낱말 수첩과 조개 연필을 든 수달 또또",
    asset: "/assets/companions/toto.svg",
    accent: "mint"
  },
  momo: {
    id: "momo",
    name: "너구리 모모",
    role: "수학과 문장제 친구",
    alt: "숫자 가방과 포도알 주판을 든 너구리 모모",
    asset: "/assets/companions/momo.svg",
    accent: "sky"
  },
  bongbong: {
    id: "bongbong",
    name: "아기용 밀키",
    role: "밀키 계산·받아쓰기 공부 조수",
    alt: "별가루 비눗방울을 내뿜는 복숭아색 아기용 밀키",
    asset: "/assets/companions/bongbong.svg",
    accent: "peach"
  }
};
