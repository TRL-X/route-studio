export type FileErrorCode =
  | 'invalid-xml'
  | 'invalid-fit'
  | 'unsupported-fit-type'
  | 'fit-no-gps'
  | 'unsupported-format'
  | 'no-routes'
  | 'invalid-coordinates'
  | 'invalid-project'
  | 'project-version'
  | 'draft-storage';

export class RouteFileError extends Error {
  constructor(public readonly code: FileErrorCode) {
    super(code);
    this.name = 'RouteFileError';
  }
}
