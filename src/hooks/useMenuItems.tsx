import {
  Settings,
  Code,
  MessagesSquare,
  WandSparkles,
  AudioLinesIcon,
  SquareSlashIcon,
  MonitorIcon,
  HomeIcon,
  PowerIcon,
  BugIcon,
  MessageSquareTextIcon,
  Brain,
  CalendarDays,
  StickyNote,
  Linkedin,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { XIcon, GithubIcon } from "@/components";

export const useMenuItems = () => {
  const menu: {
    icon: React.ElementType;
    label: string;
    href: string;
    count?: number;
  }[] = [
    {
      icon: HomeIcon,
      label: "Dashboard",
      href: "/dashboard",
    },
    {
      icon: MessagesSquare,
      label: "Chats",
      href: "/chats",
    },
    {
      icon: CalendarDays,
      label: "Meetings",
      href: "/meetings",
    },
    {
      icon: StickyNote,
      label: "Notes",
      href: "/notes",
    },
    {
      icon: WandSparkles,
      label: "System prompts",
      href: "/system-prompts",
    },
    {
      icon: Brain,
      label: "Knowledge",
      href: "/knowledge",
    },
    {
      icon: Settings,
      label: "App Settings",
      href: "/settings",
    },
    {
      icon: MessageSquareTextIcon,
      label: "Responses",
      href: "/responses",
    },
    {
      icon: MonitorIcon,
      label: "Screenshot",
      href: "/screenshot",
    },
    {
      icon: AudioLinesIcon,
      label: "Audio",
      href: "/audio",
    },
    {
      icon: SquareSlashIcon,
      label: "Cursor & Shortcuts",
      href: "/shortcuts",
    },

    {
      icon: Code,
      label: "Dev space",
      href: "/dev-space",
    },
  ];

  const footerItems = [
    {
      icon: BugIcon,
      label: "Report a bug",
      href: "https://github.com/aditnotfound",
    },
    {
      icon: PowerIcon,
      label: "Quit Veil",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [
    {
      title: "LinkedIn",
      icon: Linkedin,
      link: "https://www.linkedin.com/in/adit-patil/",
    },
    {
      title: "X",
      icon: XIcon,
      link: "https://x.com/aditnotfound",
    },
    {
      title: "GitHub",
      icon: GithubIcon,
      link: "https://github.com/aditnotfound",
    },
  ];

  return {
    menu,
    footerItems,
    footerLinks,
  };
};
