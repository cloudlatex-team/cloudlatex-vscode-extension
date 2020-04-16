const AppOrigin = 'http://localhost:3000'; //'https://cloudlatex.io';
export const ProjectsUrl = AppOrigin + '/projects';
const APIRoot = AppOrigin + '/api';
export const APIEndpoint = APIRoot + '/projects';
export const editPageUrlMatch =  /\/projects\/\d+\/edit/g; // /https\:\/\/cloudlatex.io\/projects\/\d+\/edit/g;;

export const LoginSessionKey = '_cloudlatex2_session';
export const csrfKey = 'X-CSRF-Token';
