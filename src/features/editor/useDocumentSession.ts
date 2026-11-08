import { useLayoutEffect, useRef, useState } from 'react';
import { emptyRoute, type RouteDocument } from '../../domain/model';
import { saveDraft, type Draft } from '../../platform/storage/draft';
import { useHistory } from './history';

export function useDocumentSession(restored: Draft | null, recoveryError: boolean) {
  const [history, dispatch] = useHistory(() => restored?.doc ?? emptyRoute());
  const { doc } = history;
  const currentDoc = useRef(doc);
  currentDoc.current = doc;
  const [savedDoc, markSaved] = useState(doc);
  const [projectDoc, setProjectDoc] = useState(() => (restored?.backedUp ? doc : null));
  const [source, setSource] = useState('');
  const [session, setSession] = useState(0);
  const autosave = useRef(!!restored);
  const backedUp = doc === projectDoc;
  const [draftState, setDraftState] = useState<'auto' | 'saving' | 'saved' | 'saveFailed'>(
    recoveryError ? 'saveFailed' : 'auto',
  );

  // Publish the pending status before the newly edited document is painted.
  useLayoutEffect(() => {
    if (!autosave.current) return;
    let active = true;
    setDraftState('saving');
    saveDraft({ doc, backedUp })
      .then(() => {
        if (active) setDraftState('saved');
      })
      .catch(() => {
        if (active) setDraftState('saveFailed');
      });
    return () => {
      active = false;
    };
  }, [doc, backedUp]);

  function edit(next: RouteDocument) {
    if (next === doc) return;
    autosave.current = true;
    dispatch({ type: 'edit', doc: next });
  }

  function replace(next: RouteDocument, source: string) {
    autosave.current = true;
    setSession((value) => value + 1);
    setSource(source);
    dispatch({ type: 'replace', doc: next });
    markSaved(next);
    setProjectDoc(/\.routeproj$/i.test(source) ? next : null);
  }

  function markProjectSaved(saved: RouteDocument, confirmed: boolean) {
    markSaved(saved);
    // A browser download has no completion signal available to the editor.
    if (confirmed) setProjectDoc(saved);
  }

  return {
    history,
    dispatch,
    doc,
    currentDoc,
    dirty: doc !== savedDoc,
    protectRecovered: session === 0 && !!restored && !backedUp,
    source,
    session,
    draftState,
    edit,
    replace,
    markProjectSaved,
  };
}
