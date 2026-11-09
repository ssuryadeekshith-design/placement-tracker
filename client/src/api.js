import axios from 'axios';
import { auth } from './firebase';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  withCredentials: true,
  timeout: 30000,
});
api.interceptors.request.use(async config => {
  if (auth?.currentUser) config.headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  return config;
});
export default api;
