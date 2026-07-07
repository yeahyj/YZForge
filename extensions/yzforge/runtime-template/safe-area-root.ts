import { _decorator } from 'cc';
import { YZScreenFitter } from './screen-fitter';

const { ccclass } = _decorator;

@ccclass('YZSafeAreaRoot')
export class YZSafeAreaRoot extends YZScreenFitter {
    protected fitMode: 'safe-area' = 'safe-area';
}
