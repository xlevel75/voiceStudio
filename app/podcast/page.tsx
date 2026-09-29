import type { Metadata } from "next";
import { PodcastStudio } from "@/components/podcast/PodcastStudio";

export const metadata: Metadata = {
  title: "뉴스 팟캐스트 생성기 — Voice Studio",
  description: "주제 하나로 여러 화자가 대화하는 뉴스 팟캐스트 음성을 만듭니다.",
};

export default function PodcastPage() {
  return <PodcastStudio />;
}
