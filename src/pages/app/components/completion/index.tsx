import { useCompletion } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";
import { Audio } from "./Audio";
import { Input } from "./Input";

export const Completion = ({ isHidden, showAudio = true }: { isHidden: boolean; showAudio?: boolean }) => {
  const completion = useCompletion();

  return (
    <>
      {showAudio && <Audio {...completion} />}
      <Input {...completion} isHidden={isHidden} />
      <Screenshot {...completion} />
      <Files {...completion} />
    </>
  );
};
