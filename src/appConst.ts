const AppOrigin = 'http://localhost:3000'; //'https://cloudlatex.io';
export const ProjectsUrl = AppOrigin + '/projects';
const APIRoot = AppOrigin + '/api';
export const APIEndpoint = APIRoot + '/projects';
export const ProjectsPageUrlMatch =  /\/projects/g;
export const EditPageUrlMatch =  /\/projects\/\d+\/edit/g;

export const LoginSessionKey = '_cloudlatex2_session';
export const csrfKey = 'X-CSRF-Token';
