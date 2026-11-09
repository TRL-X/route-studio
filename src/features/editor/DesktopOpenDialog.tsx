import { Button, Flex } from '@radix-ui/themes';
import { useState } from 'react';
import type { OpenFileRequest } from '../../../electron/contracts';
import type { Lang } from '../../i18n';
import en from '../../i18n/en.desktop.json';
import zh from '../../i18n/zh-CN.desktop.json';
import { Choice } from '../../ui/Choice';
import { Modal } from '../../ui/Modal';

export function DesktopOpenDialog({
  request,
  lang,
  onChoose,
  onClose,
}: {
  request: OpenFileRequest;
  lang: Lang;
  onChoose: (index: number) => void;
  onClose: () => void;
}) {
  const t = lang === 'zh' ? zh : en;
  const [index, setIndex] = useState('0');
  return (
    <Modal title={t.chooseRouteFile} onClose={onClose}>
      <p>{t.chooseRouteFileDetail}</p>
      <Choice
        autoFocus
        aria-label={t.routeFile}
        value={index}
        onValueChange={setIndex}
        options={request.names.map((name, i) => ({ value: String(i), label: `${i + 1}. ${name}` }))}
      />
      <Flex className="dialog-actions">
        <Button variant="surface" color="gray" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button onClick={() => onChoose(Number(index))}>{t.openSelectedFile}</Button>
      </Flex>
    </Modal>
  );
}
