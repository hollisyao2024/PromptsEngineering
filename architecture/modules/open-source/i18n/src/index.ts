import {createInstance,type Resource} from 'i18next';
import {initReactI18next} from 'react-i18next';
import {resources as defaults} from './resources.ts';
export {I18nextProvider,useTranslation,Trans} from 'react-i18next';
export async function createI18n(language='zh-CN',resources:Resource=defaults){
 const instance=createInstance();await instance.use(initReactI18next).init({lng:language,fallbackLng:'zh-CN',resources,interpolation:{escapeValue:false},react:{useSuspense:false}});return instance;
}
